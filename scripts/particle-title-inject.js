'use strict'

// Keep custom UI outside the Butterfly submodule so theme upgrades retain it.
const base = hexo.config.root.replace(/\/$/, '')
hexo.extend.injector.register('head_end', `<link rel="stylesheet" href="${base}/css/particle-title.css?v=1">`)
hexo.extend.injector.register('body_end', `<script defer src="${base}/js/particle-title.js?v=1"></script>`)
