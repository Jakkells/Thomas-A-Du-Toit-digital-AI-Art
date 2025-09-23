// Modal functionality
const loginModal = document.getElementById('loginModal');
const signupModal = document.getElementById('signupModal');
const loginBtn = document.getElementById('loginBtn');
const signupBtn = document.getElementById('signupBtn');
const closeLogin = document.getElementById('closeLogin');
const closeSignup = document.getElementById('closeSignup');
const switchToSignup = document.getElementById('switchToSignup');
const switchToLogin = document.getElementById('switchToLogin');

// Open modals
loginBtn.addEventListener('click', () => {
    loginModal.style.display = 'block';
});

signupBtn.addEventListener('click', () => {
    signupModal.style.display = 'block';
});

// Close modals
closeLogin.addEventListener('click', () => {
    loginModal.style.display = 'none';
});

closeSignup.addEventListener('click', () => {
    signupModal.style.display = 'none';
});

// Switch between modals
switchToSignup.addEventListener('click', (e) => {
    e.preventDefault();
    loginModal.style.display = 'none';
    signupModal.style.display = 'block';
});

switchToLogin.addEventListener('click', (e) => {
    e.preventDefault();
    signupModal.style.display = 'none';
    loginModal.style.display = 'block';
});

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    if (e.target === loginModal) {
        loginModal.style.display = 'none';
    }
    if (e.target === signupModal) {
        signupModal.style.display = 'none';
    }
});

// Form submissions (placeholder functionality)
document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Login functionality will be connected to Supabase soon!');
    loginModal.style.display = 'none';
});

document.getElementById('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    alert('Sign up functionality will be connected to Supabase soon!');
    signupModal.style.display = 'none';
});

// Search functionality
document.querySelector('.search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const searchTerm = e.target.value;
        if (searchTerm) {
            alert(`Search functionality coming soon! You searched for: "${searchTerm}"`);
        }
    }
});

// Add smooth scrolling for navigation
document.querySelectorAll('.nav-menu a').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const targetId = this.getAttribute('href').substring(1);
        console.log(`Navigation to ${targetId} - coming soon!`);
    });
});