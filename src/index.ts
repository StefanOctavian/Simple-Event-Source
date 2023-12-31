import { textReaderToLineIterator, InvalidEventSourceResponseError } from "./helper";
export { InvalidEventSourceResponseError };

const defaultRetryTime = 1000;

interface EventStreamParseBuffers {
    data: string;
    eventType: string;
    lastEventId: string;
}

export type EventSourceInit = RequestInit & { disconnectOnHidden?: boolean };

interface EventSourceEventMap {
    open: Event;
    message: MessageEvent;
    error: ErrorEvent;
}

enum EventSourceReadyState {
    CONNECTING = 0,
    OPEN = 1,
    CLOSED = 2,
}

export default class EventSource extends EventTarget {
    #reqInfo: RequestInfo | URL;
    #options?: RequestInit;
    #abortController: AbortController;
    #lastEventId?: string = "";
    #reconnectTime: number = defaultRetryTime;
    #disconnectOnHidden: boolean = false;

    #onopen: ((e: Event) => void) | null = null;
    #onmessage: ((e: MessageEvent) => void) | null = null;
    #onerror: ((e: Event) => void) | null = null;
    #onclose: ((e: Event) => void) | null = null;

    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;

    readyState: 0 | 1 | 2;
    get disconnectOnHidden(): boolean {
        return this.#disconnectOnHidden;
    }
    set disconnectOnHidden(value: boolean) {
        if (this.#disconnectOnHidden == value)
            return;
        this.#disconnectOnHidden = value;
        value ? 
            document.addEventListener("visibilitychange", this.#handleVisibilityChange) : 
            document.removeEventListener("visibilitychange", this.#handleVisibilityChange);
    }
    get url(): URL {
        if (this.#reqInfo instanceof URL)
            return this.#reqInfo;
        else if (this.#reqInfo instanceof Request)
            return new URL(this.#reqInfo.url);
        else
            return new URL(this.#reqInfo);
    }

    constructor(input: RequestInfo | URL, init?: EventSourceInit) {
        super();
        this.#reqInfo = input;
        this.#options = init;
        this.readyState = EventSourceReadyState.CONNECTING;
        this.#abortController = new AbortController();
        this.#disconnectOnHidden = init?.disconnectOnHidden ?? false;
        if (this.#disconnectOnHidden)
            document.addEventListener("visibilitychange", this.#handleVisibilityChange);

        this.#connect();
    }

    #connect(): void {
        console.log("connecting");
        // calling fetch in a synchronous function will allow the errors thrown 
        // synchronously by fetch to escape without being reported as 
        // unhandled promise errors
        let headers = new Headers(this.#options?.headers);
        headers.set("Accept", "text/event-stream");
        if (this.#lastEventId)
            headers.set("Last-Event-ID", this.#lastEventId);

        let fetchPromise = fetch(this.#reqInfo, {
            ...this.#options,
            headers,
            cache: "no-store",
            signal: this.#abortController.signal,
        });
        this.#startFetch(fetchPromise);
    }

    async #startFetch(fetchPromise: Promise<Response>): Promise<void> {
        try {
            let response = await fetchPromise;
            let contentType = response.headers.get("content-type");
            if (response.status !== 200 || !contentType?.startsWith("text/event-stream")) {
                let message = response.status === 200 
                    ? `Invalid response content-type '${contentType}'. Must be text/event-stream` 
                    : `Response status is not 200 OK (status: ${response.status} ${response.statusText})`;
                let error = new InvalidEventSourceResponseError(message, response);
                this.#fail(error);
                return;
            }
            this.#announce();
            let reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
            let lineIterator = textReaderToLineIterator(reader);
            let buffers: EventStreamParseBuffers = {
                data: "",
                eventType: "",
                lastEventId: "",
            };
            for await (let line of lineIterator) {
                this.#handleEvent(line, buffers);
            }
        } catch (e) {
            console.log(e);
            // the fetch can throw an error in the following cases:
            // - the request is aborted
            if (e instanceof DOMException && e.name === "AbortError") {
                this.#fail(null);
            }
            // - the request is a network error
            else if (e instanceof TypeError) {
                this.#reconnect(e);
            }
            // unknown error - rethrow
            else {
                throw e;
            }
        }
    }

    #handleEvent(line: string, buffers: EventStreamParseBuffers): void {
        let field: string, value : string;
        if (line === "") {
            this.#dispatch(buffers);
            return;
        } else if (line[0] == ':') {
            return;
        }
        [field, value] = line.split(/:\s?/, 2);
        value ??= "";

        if (field === "event") {
            buffers.eventType = value;
        } else if (field === "data") {
            buffers.data += value + "\n";
        } else if (field === "id") {
            if (!field.includes("\u0000"))
                buffers.lastEventId = value;
        } else if (field === "retry") {
            let retryTime = parseInt(value);
            if (!isNaN(retryTime))
                this.#reconnectTime = retryTime;
        }
    }

    #announce(): void {
        setTimeout(() => {
            if (this.readyState === EventSourceReadyState.CLOSED)
                return;
            this.readyState = EventSourceReadyState.OPEN;
            this.dispatchEvent(new Event("open"));
        }, 0);
    }

    #dispatch(buffers: EventStreamParseBuffers): void {
        this.#lastEventId = buffers.lastEventId;
        if (buffers.data === "") {
            buffers.eventType = "";
            return;
        }
        if (buffers.data.endsWith("\n")) 
            buffers.data = buffers.data.slice(0, -1);

        let event = new MessageEvent(buffers.eventType || "message", {
            data: buffers.data,
            lastEventId: buffers.lastEventId,
            origin: this.url.origin
        });

        // enqueue a task to dispatch the event
        setTimeout(() => {
            if (this.readyState !== EventSourceReadyState.CLOSED)
                this.dispatchEvent(event);
        }, 0);

        buffers.data = "";
        buffers.eventType = "";
    }

    #fail(err: Error | null): void {
        setTimeout(() => {
            if (this.readyState === EventSourceReadyState.CLOSED)
                return;
            this.readyState = EventSourceReadyState.CONNECTING;
            this.dispatchEvent(new ErrorEvent("error", {
                error: err,
                message: err?.message,
            }));
        }, 0);
    }

    async #reconnect(error: TypeError): Promise<void> {
        // enqueue a task to dispatch the error event
        let errorTask = Promise.resolve().then(() => {
            if (this.readyState === EventSourceReadyState.CLOSED)
                return;
            this.readyState = EventSourceReadyState.CONNECTING;
            this.dispatchEvent(new ErrorEvent("error", { error }));
        });
        // wait for the reconnect time and the error event to be dispatched
        await new Promise(resolve => setTimeout(resolve, this.#reconnectTime));
        await errorTask;
        Promise.resolve().then(() => {
            if (this.readyState !== EventSourceReadyState.CONNECTING)
                return;
            this.#connect();
        });
    }

    // this is a bound function so that it can be used as an event listener
    #handleVisibilityChange = () => {
        console.log("visibility change: ", document.hidden, this.readyState);
        if (document.hidden) {
            this.#abortController.abort();
            this.#abortController = new AbortController();
        } else if (this.readyState !== EventSourceReadyState.CLOSED) {
            this.readyState = EventSourceReadyState.CONNECTING;
            this.#connect();
        }
    }

    close(): void {
        this.readyState = EventSourceReadyState.CLOSED;
        this.#abortController.abort();
    }

    // all the ugly overloads to make the typescript compiler happy
    addEventListener<K extends keyof EventSourceEventMap>(type: K, listener: (e: EventSourceEventMap[K]) => void, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: (e: MessageEvent) => void, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: ((e: MessageEvent) => void) | ((e: ErrorEvent) => void) | ((e: Event) => void), options?: boolean | AddEventListenerOptions): void {
        super.addEventListener(type, listener as (e: Event) => void, options);
    }
    removeEventListener<K extends keyof EventSourceEventMap>(type: K, callback: ((e: EventSourceEventMap[K]) => void) | null, options?: boolean | EventListenerOptions): void;
    removeEventListener(type: string, callback: ((e: MessageEvent) => void) | null, options?: boolean | EventListenerOptions | undefined): void;
    removeEventListener(type: string, callback: ((e: MessageEvent) => void) | ((e: ErrorEvent) => void) | ((e: Event) => void) | null, options?: boolean | EventListenerOptions | undefined): void {
        super.removeEventListener(type, callback as (e: Event) => void, options);
    }
    
    get onopen(): ((e: Event) => void) | null { return this.#onopen; }
    set onopen(value: ((e: Event) => void) | null) {  
        if (value) this.addEventListener("open", value); 
        else this.removeEventListener("open", this.#onopen);
        this.#onopen = value;
    }
    get onmessage(): ((e: MessageEvent) => void) | null { return this.#onmessage; }
    set onmessage(value: ((e: MessageEvent) => void) | null) { 
        if (value) this.addEventListener("message", value); 
        else this.removeEventListener("message", this.#onmessage);
        this.#onmessage = value; 
    }
    get onerror(): ((e: Event) => void) | null { return this.#onerror; }
    set onerror(value: ((e: Event) => void) | null) { 
        if (value) this.addEventListener("error", value); 
        else this.removeEventListener("error", this.#onerror);
        this.#onerror = value; 
    }
    get onclose(): ((e: Event) => void) | null { return this.#onclose; }
    set onclose(value: ((e: Event) => void) | null) { 
        if (value) this.addEventListener("close", value); 
        else this.removeEventListener("close", this.#onclose);
        this.#onclose = value; 
    }
}