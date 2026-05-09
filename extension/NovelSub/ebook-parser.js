// ebook-parser.js - Parse EPUB into chapter batches using libraries
// Requires: JSZip (window.JSZip), txml (window.txml or window.tXml)

(function () {
  const EbookParser = {
    async parseEpubFile(file) {
      if (!file) {
        throw new Error("Không có file EPUB");
      }

      const lowerName = String(file.name || "").toLowerCase();
      if (!lowerName.endsWith(".epub")) {
        throw new Error("Chỉ hỗ trợ file .epub");
      }

      if (!window.JSZip) {
        throw new Error("Thiếu thư viện JSZip");
      }
      const txmlLib = window.txml || window.tXml;
      if (!txmlLib) {
        throw new Error("Thiếu thư viện txml");
      }

      const zip = await window.JSZip.loadAsync(file);

      const containerPath = "META-INF/container.xml";
      const containerEntry = zip.file(containerPath);
      if (!containerEntry) {
        throw new Error("EPUB lỗi: thiếu META-INF/container.xml");
      }

      const containerXml = await containerEntry.async("string");
      const rootfilePath = getRootfilePath(containerXml);
      if (!rootfilePath) {
        throw new Error("EPUB lỗi: không tìm thấy rootfile (.opf)");
      }

      const opfEntry = zip.file(rootfilePath);
      if (!opfEntry) {
        throw new Error(`EPUB lỗi: không tìm thấy OPF tại ${rootfilePath}`);
      }

      const opfXml = await opfEntry.async("string");
      const packageObj = parseOpfPackage(opfXml);
      if (!packageObj) {
        throw new Error("EPUB lỗi: OPF không hợp lệ");
      }

      const metadata = packageObj.metadata || {};
      const title = extractTextBySelectors(metadata, ["dc\\:title", "title"]) || file.name.replace(/\.epub$/i, "");
      const author = extractTextBySelectors(metadata, ["dc\\:creator", "creator"]) || "Unknown Author";
      const language = extractTextBySelectors(metadata, ["dc\\:language", "language"]) || "vi";

      const manifestMap = buildManifestMap(packageObj.manifest);
      const spineRefs = extractSpineRefs(packageObj.spine);
      if (spineRefs.length === 0) {
        throw new Error("EPUB lỗi: spine rỗng");
      }

      const opfDir = dirname(rootfilePath);
      const chapterBatches = [];
      const skipped = [];

      for (let i = 0; i < spineRefs.length; i++) {
        const idref = spineRefs[i];
        const manifestItem = manifestMap.get(idref);
        if (!manifestItem) {
          skipped.push({ index: i + 1, reason: `Không có manifest item cho idref=${idref}` });
          continue;
        }

        const href = manifestItem["href"] || manifestItem["path"] || manifestItem["@_href"];
        if (!href) {
          skipped.push({ index: i + 1, reason: `Manifest item ${idref} thiếu href` });
          continue;
        }

        const mediaType = (manifestItem["media-type"] || manifestItem["@_media-type"] || "").toLowerCase();
        if (!isXhtmlMediaType(mediaType) && !looksLikeHtmlPath(href)) {
          continue;
        }

        const chapterPath = normalizeZipPath(joinPath(opfDir, href));
        const chapterEntry = zip.file(chapterPath);
        if (!chapterEntry) {
          skipped.push({ index: i + 1, reason: `Thiếu chapter file: ${chapterPath}` });
          continue;
        }

        const chapterHtml = await chapterEntry.async("string");
        const chapterData = extractChapterTextFromHtml(chapterHtml, i + 1, manifestItem, href);
        if (!chapterData || chapterData.lines.length === 0) {
          skipped.push({ index: i + 1, reason: `Chapter rỗng: ${chapterPath}` });
          continue;
        }

        chapterBatches.push({
          name: chapterData.chapterTitle,
          rootFolder: null,
          projectName: sanitizeProjectName(title),
          lines: chapterData.lines,
          completed: false,
          status: "pending",
          chapterIndex: i + 1,
          chapterTitle: chapterData.chapterTitle,
          sourceType: "epub",
          sourceBookTitle: title
        });
      }

      if (chapterBatches.length === 0) {
        throw new Error("Không trích xuất được chapter hợp lệ từ EPUB");
      }

      return {
        bookTitle: title,
        metadata: {
          title,
          author,
          language,
          sourceFileName: file.name,
          createdAt: new Date().toISOString()
        },
        chapters: chapterBatches,
        skipped
      };
    }
  };

  function getRootfilePath(containerXml) {
    const doc = parseXmlDoc(containerXml);
    const rootfile = doc.querySelector("rootfile");
    return rootfile?.getAttribute("full-path") || null;
  }

  function parseOpfPackage(opfXml) {
    const doc = parseXmlDoc(opfXml);
    if (!doc) return null;
    return {
      metadata: doc.querySelector("metadata"),
      manifest: doc.querySelector("manifest"),
      spine: doc.querySelector("spine")
    };
  }

  function parseXmlDoc(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error("XML parse error");
    }
    return doc;
  }

  function buildManifestMap(manifestObj) {
    const map = new Map();
    if (!manifestObj) return map;
    const items = Array.from(manifestObj.querySelectorAll("item"));
    for (const rawItem of items) {
      const id = rawItem?.getAttribute("id");
      if (!id) continue;
      map.set(id, {
        id,
        href: rawItem?.getAttribute("href"),
        "media-type": rawItem?.getAttribute("media-type")
      });
    }
    return map;
  }

  function extractSpineRefs(spineObj) {
    if (!spineObj) return [];
    return Array.from(spineObj.querySelectorAll("itemref"))
      .map((item) => item?.getAttribute("idref"))
      .filter(Boolean);
  }

  function extractChapterTextFromHtml(html, chapterIndex, manifestItem, fallbackHref) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const titleFromDoc = (doc.querySelector("h1, h2, h3, title")?.textContent || "").trim();
    const chapterTitle = normalizeLine(
      titleFromDoc || deriveChapterTitleFromHref(chapterIndex, fallbackHref)
    );

    const paragraphs = Array.from(doc.querySelectorAll("p"));
    let lines = paragraphs
      .map((p) => normalizeLine(p.textContent || ""))
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      const bodyText = normalizeLine((doc.body?.innerText || doc.body?.textContent || ""));
      if (bodyText) {
        lines = bodyText
          .split(/\n+/)
          .map((line) => normalizeLine(line))
          .filter((line) => line.length > 0);
      }
    }

    return {
      chapterTitle,
      lines
    };
  }

  function deriveChapterTitleFromHref(index, href) {
    const base = String(href || "").split("/").pop() || `chapter_${index}`;
    return `Chapter ${index}: ${base.replace(/\.(xhtml|html|htm)$/i, "")}`;
  }

  function normalizeLine(input) {
    return String(input || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isXhtmlMediaType(mediaType) {
    return mediaType === "application/xhtml+xml" || mediaType === "text/html";
  }

  function looksLikeHtmlPath(path) {
    return /\.(xhtml|html|htm)$/i.test(String(path || ""));
  }

  function extractTextBySelectors(rootEl, selectors) {
    if (!rootEl || !Array.isArray(selectors)) return "";
    for (const sel of selectors) {
      const el = rootEl.querySelector(sel);
      const text = extractText(el);
      if (text) return text;
    }
    return "";
  }

  function extractText(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (value.nodeType === 1) return String(value.textContent || "").trim();
    return "";
  }

  function dirname(path) {
    const normalized = normalizeZipPath(path);
    const idx = normalized.lastIndexOf("/");
    if (idx < 0) return "";
    return normalized.slice(0, idx);
  }

  function joinPath(base, relative) {
    const rel = normalizeZipPath(relative);
    if (!base) return rel;
    if (rel.startsWith("/")) return rel.slice(1);
    return `${normalizeZipPath(base)}/${rel}`;
  }

  function normalizeZipPath(path) {
    return String(path || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
  }

  function sanitizeProjectName(name) {
    const value = String(name || "").trim();
    if (!value) return "Unknown_Project";
    return value.replace(/[\\/:*?"<>|]+/g, "_");
  }

  window.EbookParser = EbookParser;
})();
