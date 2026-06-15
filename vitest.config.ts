/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    // 叙事一致性测试是纯算法 + 正则，不需要 DOM/Electron 环境
    environment: 'node',
    // 仅匹配 narrative-consistency 单测，避免误扫全部 src
    include: ['src/services/narrative-consistency/__tests__/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
