document.addEventListener('DOMContentLoaded', function() {
    const notifyBtn = document.getElementById('notify-btn');
    
    notifyBtn.addEventListener('click', function() {
        alert('Thanks for your interest! We\'ll notify you when we launch! 🚀');
        
        // You can replace this alert with actual functionality later
        // For now, let's just change the button text
        notifyBtn.textContent = 'Thanks! ✅';
        notifyBtn.style.background = '#28a745';
        
        // Reset button after 3 seconds
        setTimeout(() => {
            notifyBtn.textContent = 'Get Notified';
            notifyBtn.style.background = 'linear-gradient(45deg, #667eea, #764ba2)';
        }, 3000);
    });
    
    // Add a simple fade-in animation when page loads
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease-in';
        document.body.style.opacity = '1';
    }, 100);
});