const link = document.createElement('a');
link.className = 'account-navigation';
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet';
stylesheet.href = '/account/navigation.css';
document.head.append(stylesheet);
document.body.append(link);

function update() {
  const admin = ['/dashboard', '/systemConfig', '/adminLogin'].includes(location.pathname);
  if (link.dataset.area === String(admin)) return;
  link.dataset.area = String(admin);
  link.href = admin ? '/account-review.html' : '/account.html';
  link.textContent = admin ? '注册与认领审核' : '我的账号';
}
update();
window.addEventListener('popstate', update);
new MutationObserver(update).observe(document.getElementById('app'), { childList: true, subtree: true });
