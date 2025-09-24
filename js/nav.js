export function setAdminNav(isAdmin) {
  const menu = document.querySelector('.nav-menu');
  if (!menu) return;

  let li = document.getElementById('nav-maintenance');

  if (isAdmin) {
    if (!li) {
      li = document.createElement('li');
      li.id = 'nav-maintenance';
      li.innerHTML = '<a href="#maintenance">Maintenance</a>';
      menu.appendChild(li);
    } else {
      li.style.display = '';
    }
  } else if (li) {
    li.remove();
  }
}