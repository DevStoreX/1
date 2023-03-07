const navbarToggler = document.querySelector(".navbar-toggler");
const navbarMenu = document.querySelector(".navbar-nav");

navbarToggler.addEventListener("click", function () {
  navbarMenu.classList.toggle("collapsed");
});

/* Script for transparent nav bar */
$(window).scroll(function() {
  if ($(this).scrollTop() > 50) {
    $('.navbar').addClass('navbar-transparent');
  } else {
    $('.navbar').removeClass('navbar-transparent');
  }
});


const bgImages = [
  'https://source.unsplash.com/1600x900/?nature',
  'https://source.unsplash.com/1600x900/?water',
  'https://source.unsplash.com/1600x900/?mountain',
  'https://source.unsplash.com/1600x900/?city'
];

let bgIndex = 0;
const bgImage = document.querySelector('#home');

function changeBgImage(index) {
  bgImage.style.backgroundImage = `url(${bgImages[index]})`;
}

document.querySelector('#left-arrow').addEventListener('click', () => {
  bgIndex = bgIndex === 0 ? bgImages.length - 1 : bgIndex - 1;
  changeBgImage(bgIndex);
});

document.querySelector('#right-arrow').addEventListener('click', () => {
  bgIndex = bgIndex === bgImages.length - 1 ? 0 : bgIndex + 1;
  changeBgImage(bgIndex);
});