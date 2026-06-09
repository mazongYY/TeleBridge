class Event {
  constructor(type) {
    this.type = type;
    this.isTrusted = false;
    this._yaeti = true;
  }
}

function EventTarget() {
  if (typeof this.addEventListener === "function") {
    return;
  }

  this._listeners = {};
  this.addEventListener = addEventListener;
  this.removeEventListener = removeEventListener;
  this.dispatchEvent = dispatchEvent;
}

Object.defineProperties(EventTarget.prototype, {
  listeners: {
    get() {
      return this._listeners;
    }
  }
});

function addEventListener(type, newListener) {
  if (!type || !newListener) {
    return;
  }

  const listeners = this._listeners[type] || [];
  if (!listeners.includes(newListener)) {
    listeners.push(newListener);
  }
  this._listeners[type] = listeners;
}

function removeEventListener(type, oldListener) {
  if (!type || !oldListener || !this._listeners[type]) {
    return;
  }

  const listeners = this._listeners[type];
  const index = listeners.indexOf(oldListener);
  if (index !== -1) {
    listeners.splice(index, 1);
  }

  if (listeners.length === 0) {
    delete this._listeners[type];
  }
}

function dispatchEvent(event) {
  if (!event || typeof event.type !== "string") {
    throw new Error("`event` must have a valid `type` property");
  }

  if (event._yaeti) {
    event.target = this;
    event.cancelable = true;
  }

  let stopImmediatePropagation = false;
  try {
    event.stopImmediatePropagation = () => {
      stopImmediatePropagation = true;
    };
  } catch {}

  const listener = this[`on${event.type}`];
  if (typeof listener === "function") {
    listener.call(this, event);
  }

  for (const currentListener of this._listeners[event.type] || []) {
    if (stopImmediatePropagation) {
      break;
    }
    currentListener.call(this, event);
  }

  return !event.defaultPrevented;
}

module.exports = { Event, EventTarget };
