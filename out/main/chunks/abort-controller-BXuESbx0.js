"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const privateData = /* @__PURE__ */ new WeakMap();
const wrappers = /* @__PURE__ */ new WeakMap();
function pd(event) {
  const retv = privateData.get(event);
  console.assert(
    retv != null,
    "'this' is expected an Event object, but got",
    event
  );
  return retv;
}
function setCancelFlag(data) {
  if (data.passiveListener != null) {
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error(
        "Unable to preventDefault inside passive event listener invocation.",
        data.passiveListener
      );
    }
    return;
  }
  if (!data.event.cancelable) {
    return;
  }
  data.canceled = true;
  if (typeof data.event.preventDefault === "function") {
    data.event.preventDefault();
  }
}
function Event(eventTarget, event) {
  privateData.set(this, {
    eventTarget,
    event,
    eventPhase: 2,
    currentTarget: eventTarget,
    canceled: false,
    stopped: false,
    immediateStopped: false,
    passiveListener: null,
    timeStamp: event.timeStamp || Date.now()
  });
  Object.defineProperty(this, "isTrusted", { value: false, enumerable: true });
  const keys = Object.keys(event);
  for (let i = 0; i < keys.length; ++i) {
    const key = keys[i];
    if (!(key in this)) {
      Object.defineProperty(this, key, defineRedirectDescriptor(key));
    }
  }
}
Event.prototype = {
  /**
   * The type of this event.
   * @type {string}
   */
  get type() {
    return pd(this).event.type;
  },
  /**
   * The target of this event.
   * @type {EventTarget}
   */
  get target() {
    return pd(this).eventTarget;
  },
  /**
   * The target of this event.
   * @type {EventTarget}
   */
  get currentTarget() {
    return pd(this).currentTarget;
  },
  /**
   * @returns {EventTarget[]} The composed path of this event.
   */
  composedPath() {
    const currentTarget = pd(this).currentTarget;
    if (currentTarget == null) {
      return [];
    }
    return [currentTarget];
  },
  /**
   * Constant of NONE.
   * @type {number}
   */
  get NONE() {
    return 0;
  },
  /**
   * Constant of CAPTURING_PHASE.
   * @type {number}
   */
  get CAPTURING_PHASE() {
    return 1;
  },
  /**
   * Constant of AT_TARGET.
   * @type {number}
   */
  get AT_TARGET() {
    return 2;
  },
  /**
   * Constant of BUBBLING_PHASE.
   * @type {number}
   */
  get BUBBLING_PHASE() {
    return 3;
  },
  /**
   * The target of this event.
   * @type {number}
   */
  get eventPhase() {
    return pd(this).eventPhase;
  },
  /**
   * Stop event bubbling.
   * @returns {void}
   */
  stopPropagation() {
    const data = pd(this);
    data.stopped = true;
    if (typeof data.event.stopPropagation === "function") {
      data.event.stopPropagation();
    }
  },
  /**
   * Stop event bubbling.
   * @returns {void}
   */
  stopImmediatePropagation() {
    const data = pd(this);
    data.stopped = true;
    data.immediateStopped = true;
    if (typeof data.event.stopImmediatePropagation === "function") {
      data.event.stopImmediatePropagation();
    }
  },
  /**
   * The flag to be bubbling.
   * @type {boolean}
   */
  get bubbles() {
    return Boolean(pd(this).event.bubbles);
  },
  /**
   * The flag to be cancelable.
   * @type {boolean}
   */
  get cancelable() {
    return Boolean(pd(this).event.cancelable);
  },
  /**
   * Cancel this event.
   * @returns {void}
   */
  preventDefault() {
    setCancelFlag(pd(this));
  },
  /**
   * The flag to indicate cancellation state.
   * @type {boolean}
   */
  get defaultPrevented() {
    return pd(this).canceled;
  },
  /**
   * The flag to be composed.
   * @type {boolean}
   */
  get composed() {
    return Boolean(pd(this).event.composed);
  },
  /**
   * The unix time of this event.
   * @type {number}
   */
  get timeStamp() {
    return pd(this).timeStamp;
  },
  /**
   * The target of this event.
   * @type {EventTarget}
   * @deprecated
   */
  get srcElement() {
    return pd(this).eventTarget;
  },
  /**
   * The flag to stop event bubbling.
   * @type {boolean}
   * @deprecated
   */
  get cancelBubble() {
    return pd(this).stopped;
  },
  set cancelBubble(value) {
    if (!value) {
      return;
    }
    const data = pd(this);
    data.stopped = true;
    if (typeof data.event.cancelBubble === "boolean") {
      data.event.cancelBubble = true;
    }
  },
  /**
   * The flag to indicate cancellation state.
   * @type {boolean}
   * @deprecated
   */
  get returnValue() {
    return !pd(this).canceled;
  },
  set returnValue(value) {
    if (!value) {
      setCancelFlag(pd(this));
    }
  },
  /**
   * Initialize this event object. But do nothing under event dispatching.
   * @param {string} type The event type.
   * @param {boolean} [bubbles=false] The flag to be possible to bubble up.
   * @param {boolean} [cancelable=false] The flag to be possible to cancel.
   * @deprecated
   */
  initEvent() {
  }
};
Object.defineProperty(Event.prototype, "constructor", {
  value: Event,
  configurable: true,
  writable: true
});
if (typeof window !== "undefined" && typeof window.Event !== "undefined") {
  Object.setPrototypeOf(Event.prototype, window.Event.prototype);
  wrappers.set(window.Event.prototype, Event);
}
function defineRedirectDescriptor(key) {
  return {
    get() {
      return pd(this).event[key];
    },
    set(value) {
      pd(this).event[key] = value;
    },
    configurable: true,
    enumerable: true
  };
}
function defineCallDescriptor(key) {
  return {
    value() {
      const event = pd(this).event;
      return event[key].apply(event, arguments);
    },
    configurable: true,
    enumerable: true
  };
}
function defineWrapper(BaseEvent, proto) {
  const keys = Object.keys(proto);
  if (keys.length === 0) {
    return BaseEvent;
  }
  function CustomEvent(eventTarget, event) {
    BaseEvent.call(this, eventTarget, event);
  }
  CustomEvent.prototype = Object.create(BaseEvent.prototype, {
    constructor: { value: CustomEvent, configurable: true, writable: true }
  });
  for (let i = 0; i < keys.length; ++i) {
    const key = keys[i];
    if (!(key in BaseEvent.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      const isFunc = typeof descriptor.value === "function";
      Object.defineProperty(
        CustomEvent.prototype,
        key,
        isFunc ? defineCallDescriptor(key) : defineRedirectDescriptor(key)
      );
    }
  }
  return CustomEvent;
}
function getWrapper(proto) {
  if (proto == null || proto === Object.prototype) {
    return Event;
  }
  let wrapper = wrappers.get(proto);
  if (wrapper == null) {
    wrapper = defineWrapper(getWrapper(Object.getPrototypeOf(proto)), proto);
    wrappers.set(proto, wrapper);
  }
  return wrapper;
}
function wrapEvent(eventTarget, event) {
  const Wrapper = getWrapper(Object.getPrototypeOf(event));
  return new Wrapper(eventTarget, event);
}
function isStopped(event) {
  return pd(event).immediateStopped;
}
function setEventPhase(event, eventPhase) {
  pd(event).eventPhase = eventPhase;
}
function setCurrentTarget(event, currentTarget) {
  pd(event).currentTarget = currentTarget;
}
function setPassiveListener(event, passiveListener) {
  pd(event).passiveListener = passiveListener;
}
const listenersMap = /* @__PURE__ */ new WeakMap();
const CAPTURE = 1;
const BUBBLE = 2;
const ATTRIBUTE = 3;
function isObject(x) {
  return x !== null && typeof x === "object";
}
function getListeners(eventTarget) {
  const listeners = listenersMap.get(eventTarget);
  if (listeners == null) {
    throw new TypeError(
      "'this' is expected an EventTarget object, but got another value."
    );
  }
  return listeners;
}
function defineEventAttributeDescriptor(eventName) {
  return {
    get() {
      const listeners = getListeners(this);
      let node = listeners.get(eventName);
      while (node != null) {
        if (node.listenerType === ATTRIBUTE) {
          return node.listener;
        }
        node = node.next;
      }
      return null;
    },
    set(listener) {
      if (typeof listener !== "function" && !isObject(listener)) {
        listener = null;
      }
      const listeners = getListeners(this);
      let prev = null;
      let node = listeners.get(eventName);
      while (node != null) {
        if (node.listenerType === ATTRIBUTE) {
          if (prev !== null) {
            prev.next = node.next;
          } else if (node.next !== null) {
            listeners.set(eventName, node.next);
          } else {
            listeners.delete(eventName);
          }
        } else {
          prev = node;
        }
        node = node.next;
      }
      if (listener !== null) {
        const newNode = {
          listener,
          listenerType: ATTRIBUTE,
          passive: false,
          once: false,
          next: null
        };
        if (prev === null) {
          listeners.set(eventName, newNode);
        } else {
          prev.next = newNode;
        }
      }
    },
    configurable: true,
    enumerable: true
  };
}
function defineEventAttribute(eventTargetPrototype, eventName) {
  Object.defineProperty(
    eventTargetPrototype,
    `on${eventName}`,
    defineEventAttributeDescriptor(eventName)
  );
}
function defineCustomEventTarget(eventNames) {
  function CustomEventTarget() {
    EventTarget.call(this);
  }
  CustomEventTarget.prototype = Object.create(EventTarget.prototype, {
    constructor: {
      value: CustomEventTarget,
      configurable: true,
      writable: true
    }
  });
  for (let i = 0; i < eventNames.length; ++i) {
    defineEventAttribute(CustomEventTarget.prototype, eventNames[i]);
  }
  return CustomEventTarget;
}
function EventTarget() {
  if (this instanceof EventTarget) {
    listenersMap.set(this, /* @__PURE__ */ new Map());
    return;
  }
  if (arguments.length === 1 && Array.isArray(arguments[0])) {
    return defineCustomEventTarget(arguments[0]);
  }
  if (arguments.length > 0) {
    const types = new Array(arguments.length);
    for (let i = 0; i < arguments.length; ++i) {
      types[i] = arguments[i];
    }
    return defineCustomEventTarget(types);
  }
  throw new TypeError("Cannot call a class as a function");
}
EventTarget.prototype = {
  /**
   * Add a given listener to this event target.
   * @param {string} eventName The event name to add.
   * @param {Function} listener The listener to add.
   * @param {boolean|{capture?:boolean,passive?:boolean,once?:boolean}} [options] The options for this listener.
   * @returns {void}
   */
  addEventListener(eventName, listener, options) {
    if (listener == null) {
      return;
    }
    if (typeof listener !== "function" && !isObject(listener)) {
      throw new TypeError("'listener' should be a function or an object.");
    }
    const listeners = getListeners(this);
    const optionsIsObj = isObject(options);
    const capture = optionsIsObj ? Boolean(options.capture) : Boolean(options);
    const listenerType = capture ? CAPTURE : BUBBLE;
    const newNode = {
      listener,
      listenerType,
      passive: optionsIsObj && Boolean(options.passive),
      once: optionsIsObj && Boolean(options.once),
      next: null
    };
    let node = listeners.get(eventName);
    if (node === void 0) {
      listeners.set(eventName, newNode);
      return;
    }
    let prev = null;
    while (node != null) {
      if (node.listener === listener && node.listenerType === listenerType) {
        return;
      }
      prev = node;
      node = node.next;
    }
    prev.next = newNode;
  },
  /**
   * Remove a given listener from this event target.
   * @param {string} eventName The event name to remove.
   * @param {Function} listener The listener to remove.
   * @param {boolean|{capture?:boolean,passive?:boolean,once?:boolean}} [options] The options for this listener.
   * @returns {void}
   */
  removeEventListener(eventName, listener, options) {
    if (listener == null) {
      return;
    }
    const listeners = getListeners(this);
    const capture = isObject(options) ? Boolean(options.capture) : Boolean(options);
    const listenerType = capture ? CAPTURE : BUBBLE;
    let prev = null;
    let node = listeners.get(eventName);
    while (node != null) {
      if (node.listener === listener && node.listenerType === listenerType) {
        if (prev !== null) {
          prev.next = node.next;
        } else if (node.next !== null) {
          listeners.set(eventName, node.next);
        } else {
          listeners.delete(eventName);
        }
        return;
      }
      prev = node;
      node = node.next;
    }
  },
  /**
   * Dispatch a given event.
   * @param {Event|{type:string}} event The event to dispatch.
   * @returns {boolean} `false` if canceled.
   */
  dispatchEvent(event) {
    if (event == null || typeof event.type !== "string") {
      throw new TypeError('"event.type" should be a string.');
    }
    const listeners = getListeners(this);
    const eventName = event.type;
    let node = listeners.get(eventName);
    if (node == null) {
      return true;
    }
    const wrappedEvent = wrapEvent(this, event);
    let prev = null;
    while (node != null) {
      if (node.once) {
        if (prev !== null) {
          prev.next = node.next;
        } else if (node.next !== null) {
          listeners.set(eventName, node.next);
        } else {
          listeners.delete(eventName);
        }
      } else {
        prev = node;
      }
      setPassiveListener(
        wrappedEvent,
        node.passive ? node.listener : null
      );
      if (typeof node.listener === "function") {
        try {
          node.listener.call(this, wrappedEvent);
        } catch (err) {
          if (typeof console !== "undefined" && typeof console.error === "function") {
            console.error(err);
          }
        }
      } else if (node.listenerType !== ATTRIBUTE && typeof node.listener.handleEvent === "function") {
        node.listener.handleEvent(wrappedEvent);
      }
      if (isStopped(wrappedEvent)) {
        break;
      }
      node = node.next;
    }
    setPassiveListener(wrappedEvent, null);
    setEventPhase(wrappedEvent, 0);
    setCurrentTarget(wrappedEvent, null);
    return !wrappedEvent.defaultPrevented;
  }
};
Object.defineProperty(EventTarget.prototype, "constructor", {
  value: EventTarget,
  configurable: true,
  writable: true
});
if (typeof window !== "undefined" && typeof window.EventTarget !== "undefined") {
  Object.setPrototypeOf(EventTarget.prototype, window.EventTarget.prototype);
}
class AbortSignal extends EventTarget {
  /**
   * AbortSignal cannot be constructed directly.
   */
  constructor() {
    super();
    throw new TypeError("AbortSignal cannot be constructed directly");
  }
  /**
   * Returns `true` if this `AbortSignal`'s `AbortController` has signaled to abort, and `false` otherwise.
   */
  get aborted() {
    const aborted = abortedFlags.get(this);
    if (typeof aborted !== "boolean") {
      throw new TypeError(`Expected 'this' to be an 'AbortSignal' object, but got ${this === null ? "null" : typeof this}`);
    }
    return aborted;
  }
}
defineEventAttribute(AbortSignal.prototype, "abort");
function createAbortSignal() {
  const signal = Object.create(AbortSignal.prototype);
  EventTarget.call(signal);
  abortedFlags.set(signal, false);
  return signal;
}
function abortSignal(signal) {
  if (abortedFlags.get(signal) !== false) {
    return;
  }
  abortedFlags.set(signal, true);
  signal.dispatchEvent({ type: "abort" });
}
const abortedFlags = /* @__PURE__ */ new WeakMap();
Object.defineProperties(AbortSignal.prototype, {
  aborted: { enumerable: true }
});
if (typeof Symbol === "function" && typeof Symbol.toStringTag === "symbol") {
  Object.defineProperty(AbortSignal.prototype, Symbol.toStringTag, {
    configurable: true,
    value: "AbortSignal"
  });
}
class AbortController {
  /**
   * Initialize this controller.
   */
  constructor() {
    signals.set(this, createAbortSignal());
  }
  /**
   * Returns the `AbortSignal` object associated with this object.
   */
  get signal() {
    return getSignal(this);
  }
  /**
   * Abort and signal to any observers that the associated activity is to be aborted.
   */
  abort() {
    abortSignal(getSignal(this));
  }
}
const signals = /* @__PURE__ */ new WeakMap();
function getSignal(controller) {
  const signal = signals.get(controller);
  if (signal == null) {
    throw new TypeError(`Expected 'this' to be an 'AbortController' object, but got ${controller === null ? "null" : typeof controller}`);
  }
  return signal;
}
Object.defineProperties(AbortController.prototype, {
  signal: { enumerable: true },
  abort: { enumerable: true }
});
if (typeof Symbol === "function" && typeof Symbol.toStringTag === "symbol") {
  Object.defineProperty(AbortController.prototype, Symbol.toStringTag, {
    configurable: true,
    value: "AbortController"
  });
}
exports.AbortController = AbortController;
exports.AbortSignal = AbortSignal;
exports.default = AbortController;
