// https://www.npmjs.com/package/xhr-shim under MIT

/* global module */
/* global EventTarget, AbortController, DOMException */

const sReadyState = Symbol("readyState");
const sHeaders = Symbol("headers");
const sRespHeaders = Symbol("response headers");
const sAbortController = Symbol("AbortController");
const sMethod = Symbol("method");
const sURL = Symbol("URL");
const sMIME = Symbol("MIME");
const sDispatch = Symbol("dispatch");
const sErrored = Symbol("errored");
const sTimeout = Symbol("timeout");
const sTimedOut = Symbol("timedOut");
const sIsResponseText = Symbol("isResponseText");

const XMLHttpRequestShim = class XMLHttpRequest extends EventTarget {
  onreadystatechange() {

  }

  set readyState(value) {
    this[sReadyState] = value;
    this.dispatchEvent(new Event("readystatechange"));
    this.onreadystatechange(new Event("readystatechange"));

  }
  get readyState() {
    return this[sReadyState];
  }

  constructor() {
    super();
    this.readyState = this.constructor.UNSENT;
    this.response = null;
    this.responseType = "";
    this.responseURL = "";
    this.status = 0;
    this.statusText = "";
    this.timeout = 0;
    this.withCredentials = false;
    this[sHeaders] = Object.create(null);
    this[sHeaders].accept = "*/*";
    this[sRespHeaders] = Object.create(null);
    this[sAbortController] = new AbortController();
    this[sMethod] = "";
    this[sURL] = "";
    this[sMIME] = "";
    this[sErrored] = false;
    this[sTimeout] = 0;
    this[sTimedOut] = false;
    this[sIsResponseText] = true;
  }
  static get UNSENT() {
    return 0;
  }
  static get OPENED() {
    return 1;
  }
  static get HEADERS_RECEIVED() {
    return 2;
  }
  static get LOADING() {
    return 3;
  }
  static get DONE() {
    return 4;
  }
  upload = {
    addEventListener() {
      // stub, doesn't do anything since its not possible to monitor with fetch and http/1.1
    }
  }
  get responseText() {
    if (this[sErrored]) return null;
    if (this.readyState < this.constructor.HEADERS_RECEIVED) return "";
    if (this[sIsResponseText]) return this.response;
    throw new DOMException("Response type not set to text", "InvalidStateError");
  }
  get responseXML() {
    throw new Error("XML not supported");
  }
  [sDispatch](evt) {
    const attr = `on${evt.type}`;
    if (typeof this[attr] === "function") {
      this.addEventListener(evt.type, this[attr].bind(this), {
        once: true
      });
    }
    this.dispatchEvent(evt);
  }
  abort() {
    this[sAbortController].abort();
    this.status = 0;
    this.readyState = this.constructor.UNSENT;
  }
  open(method, url) {
    this.status = 0;
    this[sMethod] = method;
    this[sURL] = url;
    this.readyState = this.constructor.OPENED;
  }
  setRequestHeader(header, value) {
    header = String(header).toLowerCase();
    if (typeof this[sHeaders][header] === "undefined") {
      this[sHeaders][header] = String(value);
    } else {
      this[sHeaders][header] += `, ${value}`;
    }
  }
  overrideMimeType(mimeType) {
    this[sMIME] = String(mimeType);
  }
  getAllResponseHeaders() {
    if (this[sErrored] || this.readyState < this.constructor.HEADERS_RECEIVED) return "";
    return Array.from(this[sRespHeaders].entries().map(([header, value]) => `${header}: ${value}`)).join("\r\n");
  }
  getResponseHeader(headerName) {
    const value = this[sRespHeaders].get(String(headerName).toLowerCase());
    return typeof value === "string" ? value : null;
  }
  send(body = null) {
    if (this.timeout > 0) {
      this[sTimeout] = setTimeout(() => {
        this[sTimedOut] = true;
        this[sAbortController].abort();
      }, this.timeout);
    }
    const responseType = this.responseType || "text";
    this[sIsResponseText] = responseType === "text";

    this.setRequestHeader('user-agent', "puter-js/1.0")
    this.setRequestHeader('origin', "https://puter.work");
    this.setRequestHeader('referer', "https://puter.work/");

    fetch(this[sURL], {
      method: this[sMethod] || "GET",
      signal: this[sAbortController].signal,
      headers: this[sHeaders],
      credentials: this.withCredentials ? "include" : "same-origin",
      body
    }).then(async resp => {
      this.responseURL = resp.url;
      this.status = resp.status;
      this.statusText = resp.statusText;
      this[sRespHeaders] = resp.headers;
      const finalMIME = this[sMIME] || this[sRespHeaders].get("content-type") || "text/plain";
      switch (responseType) {
        case "text":
          this.response = await resp.text();
          break;
        case "blob":
          this.response = new Blob([await resp.arrayBuffer()], { type: finalMIME });
          break;
        case "arraybuffer":
          this.response = await resp.arrayBuffer();
          break;
        case "json":
          this.response = await resp.json();
          break;
      }
      this.readyState = this.constructor.DONE;
      this[sDispatch](new CustomEvent("load"));
    }, err => {
      let eventName = "abort";
      if (err.name !== "AbortError") {
        this[sErrored] = true;
        eventName = "error";
      } else if (this[sTimedOut]) {
        eventName = "timeout";
      }
      this.readyState = this.constructor.DONE;
      this[sDispatch](new CustomEvent(eventName));
    }).finally(() => this[sDispatch](new CustomEvent("loadend"))).finally(() => {
      clearTimeout(this[sTimeout]);
      this[sDispatch](new CustomEvent("loadstart"));
    });
  }
}

if (typeof module === "object" && module.exports) {
  module.exports = XMLHttpRequestShim;
} else {
  (globalThis || self).XMLHttpRequestShim = XMLHttpRequestShim;
}

export default XMLHttpRequestShim