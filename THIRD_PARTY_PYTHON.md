# Third-Party Python Runtime (Windows x64)

## Summary

This app bundles an embedded Python runtime for Windows x64 to run CapCut automation features offline on user machines.

- Python runtime: `Python 3.12.x (embedded distribution)`
- Runtime location at build time: `resources/python/win32-x64/runtime`
- Runtime location in packaged app: `process.resourcesPath/python`
- Preparation command: `npm run prepare:python-runtime`

## Bundled Python Packages

Versions are pinned in `requirements-pycapcut-lock.txt`:

- `pycapcut==0.0.3`
- `imageio==2.37.2`
- `pymediainfo==7.0.1`
- `uiautomation==2.0.29`
- `comtypes==1.4.15`
- `numpy==2.3.4`
- `pillow==11.3.0`
- `undetected-chromedriver==3.5.5`
- `grok3api` (bundled từ local repo)

## External Python Packages (Not Bundled)

Không có package bắt buộc bên ngoài cho Grok UI trên Windows x64.

## License Collection

During `npm run prepare:python-runtime`, license metadata is copied into:

- `resources/licenses/python/PYTHON_LICENSE.txt`
- `resources/licenses/python/<package>/pip-show.txt`
- `resources/licenses/python/<package>/(LICENSE*|COPYING*|NOTICE*|METADATA|licenses/)`

Packaged app location:

- `process.resourcesPath/licenses/python`

## Notes

- The bundled runtime is Windows x64 only.
- If runtime files are missing or corrupted after installation, reinstall the app.
- Grok3API được copy từ `D:\Grok\Grok3API\grok3api` vào embedded runtime khi chạy `npm run prepare:python-runtime`.
