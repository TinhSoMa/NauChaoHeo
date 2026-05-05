import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

export async function loadBackgroundHooks({ repoRoot, chromeMock }) {
  const filePath = path.join(repoRoot, "extension", "background.js");
  const source = await fs.readFile(filePath, "utf8");

  const hookCode = `
globalThis.__backgroundHooks = {
  validateTranslationCount,
  validateEbookNovelCompletion,
  saveBatchFilesForActiveMode
};
`;

  const context = vm.createContext({
    chrome: chromeMock,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    TextEncoder,
    TextDecoder,
    globalThis: {}
  });
  context.globalThis = context;

  const script = new vm.Script(`${source}\n${hookCode}`, {
    filename: "background.js"
  });
  script.runInContext(context);

  return context.__backgroundHooks;
}

