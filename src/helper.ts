export async function* textReaderToLineIterator(reader: ReadableStreamDefaultReader<string>) {
    let re = /\r\n|\r|\n/gm;
    let lastLine = "";
    let readResult = await reader.read();
    while (!readResult.done) {
        let chunk = readResult.value;
        let lines = chunk.split(re);
        if (lastLine !== "") 
            lines[0] = lastLine + lines[0];
        lastLine = lines[lines.length - 1];
        lines.length -= 1;
        yield* lines;
        readResult = await reader.read();
    }
    // if the last line doesn't end with a newline, we still want to yield it
    if (lastLine !== "")
        yield lastLine;
}

export class ReconnectingEventSourceError extends Error {
    constructor() {
        super("Reconnecting EventSource.");
        this.name = "ReconnectingEventSourceError";
    }
}

export class InvalidEventSourceResponseError extends Error {
    response: Response;
    constructor(message: string, response: Response) {
        super(message);
        this.name = "InvalidResponseError";
        this.response = response;
    }
}