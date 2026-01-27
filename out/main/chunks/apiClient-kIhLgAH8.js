"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const index = require("../index.js");
require("electron");
require("@electron-toolkit/utils");
require("path");
require("fs");
require("crypto");
require("fs/promises");
require("child_process");
require("uuid");
require("better-sqlite3");
async function makeRequestWithProxy(url, options = {}, maxRetries = 3) {
  const {
    method = "GET",
    headers = {},
    body = null,
    timeout = 15e4,
    // Tăng lên 15s (proxy chậm hơn direct)
    useProxy = true
  } = options;
  const proxyManager = index.getProxyManager();
  let lastError = "";
  let currentProxy = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (useProxy) {
        currentProxy = proxyManager.getNextProxy();
      }
      console.log(`[ApiClient] Request ${method} ${url} (Attempt ${attempt + 1}/${maxRetries})${currentProxy ? ` via ${currentProxy.host}:${currentProxy.port}` : " (direct)"}`);
      const result = await makeRequest(url, {
        method,
        headers,
        body,
        timeout,
        proxy: currentProxy
      });
      if (currentProxy) {
        proxyManager.markProxySuccess(currentProxy.id);
      }
      return {
        success: true,
        data: result.data,
        statusCode: result.statusCode
      };
    } catch (error) {
      lastError = error.message || String(error);
      if (currentProxy) {
        proxyManager.markProxyFailed(currentProxy.id, lastError);
      }
      console.warn(`[ApiClient] ❌ Attempt ${attempt + 1} failed:`, lastError);
      if (attempt < maxRetries - 1) {
        console.log(`[ApiClient] 🔄 Retry với proxy khác...`);
        await sleep(500);
        continue;
      }
    }
  }
  if (useProxy && proxyManager.shouldFallbackToDirect()) {
    console.log("[ApiClient] 🔄 Fallback về direct connection...");
    try {
      const result = await makeRequest(url, {
        method,
        headers,
        body,
        timeout,
        proxy: null
      });
      console.log("[ApiClient] ✅ Direct connection thành công");
      return {
        success: true,
        data: result.data,
        statusCode: result.statusCode
      };
    } catch (error) {
      lastError = error.message || String(error);
      console.error("[ApiClient] ❌ Direct connection cũng thất bại:", lastError);
    }
  }
  return {
    success: false,
    error: `Request failed after ${maxRetries} retries: ${lastError}`
  };
}
async function makeRequest(url, options) {
  const { default: fetch } = await import("node-fetch");
  const { HttpsProxyAgent } = await import("https-proxy-agent");
  const { SocksProxyAgent } = await import("socks-proxy-agent");
  const AbortController = globalThis.AbortController || (await Promise.resolve().then(() => require("./abort-controller-BXuESbx0.js"))).AbortController;
  let agent = void 0;
  if (options.proxy) {
    const p = options.proxy;
    const proxyUrl = p.username ? `${p.type}://${p.username}:${p.password}@${p.host}:${p.port}` : `${p.type}://${p.host}:${p.port}`;
    if (p.type === "socks5") {
      agent = new SocksProxyAgent(proxyUrl, {
        timeout: options.timeout
      });
    } else {
      agent = new HttpsProxyAgent(proxyUrl, {
        timeout: options.timeout,
        rejectUnauthorized: false,
        // Allow self-signed certs from proxy
        keepAlive: false
        // Don't keep connections alive
      });
    }
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout);
  try {
    const fetchOptions = {
      method: options.method,
      headers: options.headers,
      signal: controller.signal
    };
    if (agent) {
      fetchOptions.agent = agent;
    }
    if (options.body) {
      if (typeof options.body === "string") {
        fetchOptions.body = options.body;
      } else {
        fetchOptions.body = JSON.stringify(options.body);
        fetchOptions.headers["Content-Type"] = "application/json";
      }
    }
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    return {
      data,
      statusCode: response.status
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`network timeout at: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.makeRequestWithProxy = makeRequestWithProxy;
