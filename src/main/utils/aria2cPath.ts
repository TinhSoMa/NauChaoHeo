/**
 * aria2c Path Utilities - Resolve aria2c path for dev and packaged app
 */

import { app } from 'electron'
import path from 'path'
import { existsSync } from 'fs'

export function getAria2cPath(): string {
  const isPackaged = app.isPackaged
  const isWin = process.platform === 'win32'

  if (isWin) {
    if (isPackaged) {
      return path.join(process.resourcesPath, 'aria2c', 'aria2c.exe')
    }
    return path.join(app.getAppPath(), 'resources', 'aria2c', 'win64', 'aria2c.exe')
  }

  if (isPackaged) {
    return path.join(process.resourcesPath, 'aria2c', 'aria2c')
  }
  return path.join(app.getAppPath(), 'resources', 'aria2c', 'bin', 'aria2c')
}

export function isAria2cAvailable(): boolean {
  return existsSync(getAria2cPath())
}
