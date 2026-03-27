const hamburger = document.querySelector('.hamburger');
const mobileNav = document.getElementById('mobile-nav');

hamburger.addEventListener('click', () => {
  const isOpen = mobileNav.classList.toggle('is-open');
  hamburger.setAttribute('aria-expanded', isOpen);
  mobileNav.setAttribute('aria-hidden', !isOpen);
});

// Close mobile nav when a link is tapped
mobileNav.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    mobileNav.classList.remove('is-open');
    hamburger.setAttribute('aria-expanded', 'false');
    mobileNav.setAttribute('aria-hidden', 'true');
  });
});
