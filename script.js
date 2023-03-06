const navbarToggler = document.querySelector(".navbar-toggler");
const navbarMenu = document.querySelector(".navbar-nav");

navbarToggler.addEventListener("click", function () {
  navbarMenu.classList.toggle("collapsed");
});