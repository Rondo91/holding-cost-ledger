/* 创作者浮层：顶栏「创作者」按钮 → 姓名与联系方式。
   两个页面（index / design）共用，靠 DOM 自检决定是否挂载，不依赖 app.js。
   不接埋点：这是个静态署名入口，点开人数不构成任何作品论证，
   为它去改事件白名单与数据库 props 约束不值得。 */

const btn = document.getElementById('creator-btn');
const panel = document.getElementById('creator');

if (btn && panel) {
  const setOpen = (open) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();   // 否则下面这条 document 监听会立刻把它关掉
    setOpen(panel.hidden);
  });

  // 点击浮层外部关闭；点浮层内部（比如复制邮箱）保持打开
  document.addEventListener('click', (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || btn.contains(e.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      btn.focus();
    }
  });
}
