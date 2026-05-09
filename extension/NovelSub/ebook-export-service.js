// ebook-export-service.js - Build EPUB from translated ebook chapters
// Requires: JSZip (window.JSZip)

(function () {
  class EbookExportService {
    static async buildEpubBlob({ bookMeta, chapters }) {
      if (!window.JSZip) {
        throw new Error("Thiếu thư viện JSZip cho export EPUB");
      }
      if (!Array.isArray(chapters) || chapters.length === 0) {
        throw new Error("Không có chapter đã dịch để đóng gói EPUB");
      }

      const meta = {
        title: sanitizeText(bookMeta?.title || "Untitled"),
        author: sanitizeText(bookMeta?.author || "Unknown Author"),
        language: sanitizeText(bookMeta?.language || "vi"),
        identifier: sanitizeText(bookMeta?.identifier || `book-${Date.now()}`)
      };

      const zip = new window.JSZip();

      // EPUB requirement: mimetype first and uncompressed.
      zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
      zip.file("META-INF/container.xml", buildContainerXml());

      const oebps = zip.folder("OEBPS");
      if (!oebps) {
        throw new Error("Không thể tạo thư mục OEBPS");
      }

      const chapterItems = chapters
        .map((chapter, idx) => {
          const order = idx + 1;
          const fileName = `chapter-${String(order).padStart(4, "0")}.xhtml`;
          const chapterId = `chap_${order}`;
          const title = sanitizeText(chapter.chapterTitle || chapter.name || `Chapter ${order}`);
          const html = buildChapterXhtml(title, chapter.content || "");
          return { order, fileName, chapterId, title, html };
        });

      for (const item of chapterItems) {
        oebps.file(item.fileName, item.html);
      }

      oebps.file("nav.xhtml", buildNavXhtml(meta.title, chapterItems));
      oebps.file("toc.ncx", buildNcx(meta, chapterItems));
      oebps.file("content.opf", buildOpf(meta, chapterItems));

      return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
    }
  }

  function buildContainerXml() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  }

  function buildOpf(meta, chapterItems) {
    const manifestChapters = chapterItems
      .map((c) => `<item id="${c.chapterId}" href="${c.fileName}" media-type="application/xhtml+xml"/>`)
      .join("\n    ");
    const spineChapters = chapterItems
      .map((c) => `<itemref idref="${c.chapterId}"/>`)
      .join("\n    ");
    const now = new Date().toISOString();

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(meta.identifier)}</dc:identifier>
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:creator>${escapeXml(meta.author)}</dc:creator>
    <dc:language>${escapeXml(meta.language)}</dc:language>
    <meta property="dcterms:modified">${now}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${manifestChapters}
  </manifest>
  <spine toc="ncx">
    ${spineChapters}
  </spine>
</package>`;
  }

  function buildNcx(meta, chapterItems) {
    const navPoints = chapterItems
      .map((c) => `    <navPoint id="navPoint-${c.order}" playOrder="${c.order}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${c.fileName}"/>
    </navPoint>`)
      .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(meta.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(meta.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`;
  }

  function buildNavXhtml(bookTitle, chapterItems) {
    const links = chapterItems
      .map((c) => `<li><a href="${c.fileName}">${escapeHtml(c.title)}</a></li>`)
      .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="vi">
  <head>
    <meta charset="UTF-8"/>
    <title>${escapeHtml(bookTitle)}</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc" role="doc-toc">
      <h1>${escapeHtml(bookTitle)}</h1>
      <ol>
        ${links}
      </ol>
    </nav>
  </body>
</html>`;
  }

  function buildChapterXhtml(chapterTitle, content) {
    const paragraphs = String(content || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join("\n    ");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="vi">
  <head>
    <meta charset="UTF-8"/>
    <title>${escapeHtml(chapterTitle)}</title>
  </head>
  <body>
    <h1>${escapeHtml(chapterTitle)}</h1>
    ${paragraphs}
  </body>
</html>`;
  }

  function sanitizeText(text) {
    return String(text || "").trim();
  }

  function escapeXml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.EbookExportService = EbookExportService;
})();

