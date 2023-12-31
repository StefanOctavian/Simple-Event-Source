# Simple TS Event Source

## Description
This library provides a polyfill for the EventSource API, but does not follow the exact specification, adding extra features on top of it, making up for the gaps in the native API. It is made to be used in the browser, but it can be used in Node.js as well except for the `disconnectOnHidden` option, which uses the browser visibility API. Written in TypeScript ES2018 using the Fetch Streams API, it is a lightweight library with no dependencies.

## Installation
Using npm:
```shell
$ npm i --save simple-ts-event-source
```

## Usage
The `EventSource` class is the default export of the library and exposes an interface similar to the native API. It can be used as follows:
```typescript
import EventSource from 'simple-event-source';

const url = 'http://localhost:5000'; // pass a string, URL object or Request object
const eventSource = new EventSource(url, {
    method: 'POST', // pass any options that the Fetch API accepts
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}}`
    },
    disconnectOnHidden: true, // disconnect when the page is hidden (default: false)
});
eventSource.onopen = () => console.log('Connection opened');
eventSource.addEventListener('message', (event: MessageEvent) => console.log(event.data));
eventSource.onerror = (e: ErrorEvent) => console.error(e.error);
eventSource.addEventListener('custom-event', (event: MessageEvent) => console.log(event.data));

// close the connection when you're done
eventSource.close();
```
When the connection to the server is lost, first an `ErrorEvent` is fired to the `onerror` handler, containing in its `error` property a Network Error that was thrown by the Fetch API, then a reconnection is attempted after 1 second by default. The reconnection timeout can be changed by the server by sending a `retry` field in the event stream, which is the number of milliseconds to wait before attempting to reconnect.

## API Reference
### `type EventSourceInit`
```ts 
type EventSourceInit = RequestInit & { disconnectOnHidden?: boolean }
```

### `class EventSource`
- inherits from `EventTarget`
- instance properties
    - `readyState: 0 | 1 | 2`: the current state of the connection:
        * `0`: CONNECTING
        * `1`: OPEN
        * `2`: CLOSED
    - `get url: string`: the URL that the connection is made to
    - `get/set disconnectOnHidden: boolean`: whether to disconnect the event source when the page becomes hidden and reconnect when it becomes visible again. Defaults to `false`.
- static properties:
    - `CONNECTING: 0 = 0`: the connection is not yet open
    - `OPEN: 1 = 1`: the connection is open and ready to receive messages
    - `CLOSED: 2 = 2`: the connection is closed or could not be opened
- `constructor(input: string | URL | Request, options?: EventSourceInit)`
    - `input`: the URL to connect to or a Request object to use 
    - `options`: options to pass to the Fetch API. Same as the `RequestInit` interface, but with an extra `disconnectOnHidden` option to disconnect the event source when the page becomes hidden and reconnect when it becomes visible again. Defaults to `false`.
- instance methods
    - `close(): void`: closes the connection. When the connection is closed, the `onerror` event is fired with an `ErrorEvent` object whose `error` property is set to `null`. This is to comply with the specification, but since it doesn't seem like a very helpful behaviour, the error event is made easy to ignore by checking for `!event.error` in the `onerror` handler or just checking for the other types of errors only.
- instance events
    - `onopen: (event: Event) => void`: an event handler called when the connection is opened. The `Event` object doesn't contain any particularilly useful information.
    - `onmessage: (event: MessageEvent) => void`: an event handler called when a message is received. The `MessageEvent` object contains the `data` property, which is the message received.
    - `onerror: (event: ErrorEvent) => void`: an event handler called when an error occurs. The handler is passed an `ErrorEvent` object containing an `error` field which can take one of the following types of errors:
        * `null`: the connection was closed by the user, using the `close()` method
        * `TypeError`: the connection was lost because of a network error. The `TypeError` object corresponds to the error thrown by the Fetch API.
        * `InvalidEventSourceResponseError`: the server sent a response that is not a valid event stream. A valid event stream is a response with a `Content-Type` header that starts with `text/event-stream` and a status code of `200`.
    - any other string than 'open', 'message' or 'error': `(event: MessageEvent) => void`: an event handler called when an event with the same name is received. The `MessageEvent` object contains the `data` property, which is the message received.