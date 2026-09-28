/**
 * 粒子标题注入脚本
 * ---------------------------------------------------------------------------
 * Hexo 启动时会自动加载站点根目录 scripts/ 下的所有 .js 文件。
 * 这里用 after_render:html 过滤器，把粒子标题的样式与脚本挂到页面里，
 * 好处是：
 *   1. 完全不动 themes/butterfly 子模块，主题升级不会覆盖掉效果；
 *   2. 资源路径跟着 _config.yml 的 root 走，本地（/）和 GitHub Pages
 *      （/my-blog/）都能正确加载；
 *   3. 默认只在首页注入；若主题开了 pjax，则所有页面都注入，
 *      以免站内跳转回首页时脚本还没加载。
 *
 * 真正的效果由 source/js/particle-title.js 负责，它只在
 * 「首页横幅里存在 #site-info #site-title」时才启动，其它页面自动跳过。
 */
'use strict';

const CSS_ASSET = 'css/particle-title.css';
const JS_ASSET = 'js/particle-title.js';

/* 按 root 拼出资源地址，例如 root=/my-blog/ → /my-blog/js/particle-title.js */
function withRoot(root, asset) {
  let r = root || '/';
  if (r.charAt(r.length - 1) !== '/') r += '/';
  return r + asset;
}

hexo.extend.filter.register('after_render:html', function (str, data) {
  if (!str || typeof str !== 'string') return str;
  if (str.indexOf(JS_ASSET) !== -1) return str;            /* 幂等：已注入就跳过 */

  const path = (data && data.path) || '';
  const isHome = path === '' || path === 'index.html';

  const themeCfg = (hexo.theme && hexo.theme.config) || {};
  const pjaxOn = !!(themeCfg.pjax && themeCfg.pjax.enable) ||
    !!(hexo.config && hexo.config.pjax && hexo.config.pjax.enable);

  /* 非首页又没开 pjax 时不必加载，省一个没用的请求 */
  if (!isHome && !pjaxOn) return str;

  const root = (hexo.config && hexo.config.root) || '/';
  const title = String((hexo.config && hexo.config.title) || '');

  const cssTag = '<link rel="stylesheet" href="' + withRoot(root, CSS_ASSET) + '">';
  const cfgTag = '<script>window.__PARTICLE_TITLE__=' +
    JSON.stringify({ title: title }) + ';<\/script>';
  const jsTag = '<script defer src="' + withRoot(root, JS_ASSET) + '"><\/script>';

  let out = str;
  out = /<\/head>/i.test(out)
    ? out.replace(/<\/head>/i, cssTag + '</head>')
    : cssTag + out;

  out = /<\/body>/i.test(out)
    ? out.replace(/<\/body>/i, cfgTag + jsTag + '</body>')
    : out + cfgTag + jsTag;

  return out;
});
