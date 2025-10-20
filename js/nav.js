export function setAdminNav(isAdmin) {
  const menu = document.querySelector('.nav-menu');
  if (!menu) return;

  let li = document.getElementById('nav-maintenance');
  let liPending = document.getElementById('nav-pending');

  if (isAdmin) {
    if (!li) {
      li = document.createElement('li');
      li.id = 'nav-maintenance';
      li.innerHTML = '<a href="#maintenance">Maintenance</a>';
      menu.appendChild(li);
    } else {
      li.style.display = '';
    }

    if (!liPending) {
      liPending = document.createElement('li');
      liPending.id = 'nav-pending';
      liPending.innerHTML = '<a href="#pending">Pending</a>';
      menu.appendChild(liPending);
    } else {
      liPending.style.display = '';
    }
  } else if (li) {
    li.remove();
    if (liPending) liPending.remove();
  }
}