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

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabaseUrl = window.SUPABASE_URL;
const supabaseKey = window.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Login form
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        alert('Login failed: ' + error.message);
    } else {
        alert('Login successful!');
        loginModal.style.display = 'none';
    }
});

// Signup form
document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('signupName').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;

    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
        alert('Sign up failed: ' + error.message);
        return;
    }

    // Insert profile after successful sign up
    if (data.user) {
        const { error: profileError } = await supabase
            .from('profiles')
            .insert([{ id: data.user.id, name }]);
        if (profileError) {
            alert('Profile creation failed: ' + profileError.message);
        } else {
            alert('Sign up successful!');
            signupModal.style.display = 'none';
        }
    }
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