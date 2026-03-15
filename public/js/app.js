document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const sectionRequest = document.getElementById('step1-request');
    const sectionVerify = document.getElementById('step2-verify');
    const sectionDashboard = document.getElementById('step3-dashboard');

    const chatIdInput = document.getElementById('chatIdInput');
    const sendCodeBtn = document.getElementById('sendCodeBtn');
    const requestMsg = document.getElementById('requestMsg');

    const codeInput = document.getElementById('codeInput');
    const verifyCodeBtn = document.getElementById('verifyCodeBtn');
    const verifyMsg = document.getElementById('verifyMsg');
    const resendCodeBtn = document.getElementById('resendCodeBtn');

    const displayUserId = document.getElementById('displayUserId');

    const modal = document.getElementById('helpModal');
    const howToFindIdBtn = document.getElementById('howToFindId');
    const closeBtn = document.querySelector('.close-btn');

    let currentChatId = '';

    // Check localStorage for existing session
    const storedUserId = localStorage.getItem('userId');
    const storedUserName = localStorage.getItem('userName');
    const storedPhotoUrl = localStorage.getItem('photoUrl');
    const storedBalance = localStorage.getItem('balance') || '0';

    if (storedUserId) {
        sectionRequest.classList.remove('active');
        sectionDashboard.classList.add('active');

        document.getElementById('displayUserId').textContent = storedUserId;
        document.getElementById('displayUserName').textContent = storedUserName || 'User';
        document.getElementById('displayUserBalance').textContent = parseFloat(storedBalance).toFixed(2);
        
        const refLinkInput = document.getElementById('displayReferralLink');
        if (refLinkInput) {
            refLinkInput.value = `https://t.me/bin_shopee_bot?start=${storedUserId}`;
        }

        if (storedPhotoUrl && storedPhotoUrl !== 'undefined' && storedPhotoUrl !== 'null') {
            const avatarImg = document.getElementById('userAvatar');
            const defaultIcon = document.getElementById('defaultAvatarIcon');
            if (avatarImg) avatarImg.src = storedPhotoUrl;
            if (avatarImg) avatarImg.style.display = 'block';
            if (defaultIcon) defaultIcon.style.display = 'none';
        }
        
        loadGlobalSettings();
    } else {
        sectionRequest.classList.add('active');
    }

    // Modals
    howToFindIdBtn.addEventListener('click', () => {
        modal.classList.add('active');
    });

    closeBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    });

    // Handle Send Code
    sendCodeBtn.addEventListener('click', async () => {
        const chatId = chatIdInput.value.trim();
        if (!chatId) {
            showMessage(requestMsg, 'Please enter your Chat ID', 'error');
            return;
        }

        setLoading(sendCodeBtn, true, 'Sending...');

        try {
            const response = await fetch('/api/send-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId })
            });

            const data = await response.json();

            if (data.success) {
                currentChatId = chatId;
                sectionRequest.classList.remove('active');
                sectionVerify.classList.add('active');
            } else {
                showMessage(requestMsg, data.message || 'Failed to send code. Ensure bot is started.', 'error');
            }
        } catch (error) {
            showMessage(requestMsg, 'Network error. Please try again.', 'error');
        } finally {
            setLoading(sendCodeBtn, false, 'Send Verification Code', 'fa-arrow-right');
        }
    });

    // Handle Verify Code
    verifyCodeBtn.addEventListener('click', async () => {
        const code = codeInput.value.trim();
        if (!code || code.length !== 6) {
            showMessage(verifyMsg, 'Please enter a valid 6-digit code', 'error');
            return;
        }

        setLoading(verifyCodeBtn, true, 'Verifying...');

        try {
            const response = await fetch('/api/verify-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: currentChatId, code })
            });

            const data = await response.json();

            if (data.success) {
                // Save session to localStorage
                localStorage.setItem('userId', data.userId);
                localStorage.setItem('userName', data.name || 'User');
                localStorage.setItem('balance', data.balance || 0);
                if (data.photoUrl) {
                    localStorage.setItem('photoUrl', data.photoUrl);
                }

                sectionVerify.classList.remove('active');
                sectionDashboard.classList.add('active');

                document.getElementById('displayUserId').textContent = data.userId;
                document.getElementById('displayUserName').textContent = data.name || 'User';
                document.getElementById('displayUserBalance').textContent = parseFloat(data.balance || 0).toFixed(2);
                
                const refLinkInput = document.getElementById('displayReferralLink');
                if (refLinkInput) {
                    refLinkInput.value = `https://t.me/bin_shopee_bot?start=${data.userId}`;
                }

                if (data.photoUrl) {
                    const avatarImg = document.getElementById('userAvatar');
                    const defaultIcon = document.getElementById('defaultAvatarIcon');
                    if(avatarImg) avatarImg.src = data.photoUrl;
                    if (avatarImg) avatarImg.style.display = 'block';
                    if (defaultIcon) defaultIcon.style.display = 'none';
                }

                loadGlobalSettings();
            } else {
                showMessage(verifyMsg, data.message || 'Verification failed', 'error');
            }
        } catch (error) {
            showMessage(verifyMsg, 'Network error. Please try again.', 'error');
        } finally {
            setLoading(verifyCodeBtn, false, 'Verify Account', 'fa-check');
        }
    });

    // Handle Reset/Back
    resendCodeBtn.addEventListener('click', () => {
        sectionVerify.classList.remove('active');
        sectionRequest.classList.add('active');
        codeInput.value = '';
        verifyMsg.className = 'message';
        verifyMsg.textContent = '';
    });

    // Helper functions
    window.copyReferralLink = function() {
        const linkInput = document.getElementById('displayReferralLink');
        if (linkInput) {
            navigator.clipboard.writeText(linkInput.value).then(() => {
                alert('Referral Link Copied! Share it with friends to earn USDT.');
            });
        }
    };

    async function loadGlobalSettings() {
        try {
            const res = await fetch('/api/admin/settings');
            const data = await res.json();
            if (data.success && data.settings) {
                const rewardElement = document.getElementById('displayReferralReward');
                if (rewardElement) {
                    rewardElement.textContent = parseFloat(data.settings.referralBonus || 0).toFixed(2);
                }
            }
        } catch (error) {
            console.error('Failed to load settings:', error);
        }
    }

    function showMessage(element, text, type) {
        element.textContent = text;
        element.className = `message ${type}`;
    }

    function setLoading(btn, isLoading, text, iconClass = '') {
        if (isLoading) {
            btn.innerHTML = `<i class="fa-solid fa-spinner spinner"></i> <span>${text}</span>`;
            btn.disabled = true;
        } else {
            btn.innerHTML = `<span>${text}</span> <i class="fa-solid ${iconClass}"></i>`;
            btn.disabled = false;
        }
    }
});
