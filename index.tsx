
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { 
    getAuth, 
    onAuthStateChanged, 
    RecaptchaVerifier, 
    signInWithPhoneNumber, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut 
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    where, 
    query, 
    addDoc, 
    doc, 
    getDoc, 
    updateDoc, 
    runTransaction, 
    setDoc,
    limit
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// FIX: Augment the Window interface to include recaptchaVerifier
declare global {
    interface Window {
        recaptchaVerifier: RecaptchaVerifier;
    }
}

// =================================================================
// CONFIGURACIÓN DE FIREBASE
// =================================================================

const firebaseConfig = {
    apiKey: "AIzaSyDmSlCtdNDl2oVLy3z1gBJuf8Isopafryk",
    authDomain: "loyalflyapp.firebaseapp.com",
    projectId: "loyalflyapp",
    storageBucket: "loyalflyapp.firebasestorage.app",
    messagingSenderId: "1093662489331",
    appId: "1:1093662489331:web:1ba3a3fb3b0939d4411586",
    measurementId: "G-5B3HNP5R74"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// =================================================================
// ESTADO GLOBAL DE LA APP
// =================================================================
let state = {
    authUser: null, // Almacenará un objeto plano con datos del usuario para evitar errores de serialización circulares
    userProfile: null, // Almacenará datos de 'clients' o 'businesses' de Firestore
    userType: null, // 'client' o 'business'
};
// El objeto confirmationResult se mantiene fuera del estado global para evitar errores de estructura circular.
let confirmationResult = null;
let currentViewId = 'client-login-view';

// =================================================================
// SELECTORES DEL DOM
// =================================================================
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');

const modals = {
    otp: document.getElementById('otp-modal'),
    rewardConfig: document.getElementById('reward-config-modal'),
    addClient: document.getElementById('add-client-modal'),
    alert: document.getElementById('alert-modal')
};
const splashScreen = document.getElementById('splash-screen');

// =================================================================
// LÓGICA DE NAVEGACIÓN Y MODALES
// =================================================================
const showView = (viewId) => {
    if (viewId === currentViewId) return;

    const currentView = document.getElementById(currentViewId);
    const targetView = document.getElementById(viewId);

    if (currentView) {
        currentView.classList.remove('active');
    }

    if (targetView) {
        targetView.classList.add('active');
    }
    
    currentViewId = viewId;
};

const showModal = (modalId) => modals[modalId] && modals[modalId].classList.remove('hidden');
const hideModal = (modalId) => modals[modalId] && modals[modalId].classList.add('hidden');

const ICONS = {
    success: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />',
    error: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />',
    info: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />'
};

const showAlert = (message, type = 'error') => {
    document.getElementById('alert-message').textContent = message;
    document.getElementById('alert-icon-svg').innerHTML = ICONS[type] || ICONS.info;
    const titleEl = document.getElementById('alert-title');
    const iconContainer = document.getElementById('alert-icon-container');

    if (type === 'error') { titleEl.textContent = 'Error'; iconContainer.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-500 mb-4'; } 
    else if (type === 'success') { titleEl.textContent = 'Éxito'; iconContainer.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-menta mb-4'; } 
    else { titleEl.textContent = 'Aviso'; iconContainer.className = 'mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-blue-500 mb-4'; }
    
    showModal('alert');
};

const loadSplashScreenConfig = async () => {
    try {
        const configDocRef = doc(db, 'config', 'global');
        const configDoc = await getDoc(configDocRef);
        if (configDoc.exists()) {
            const config = configDoc.data();
            document.getElementById('splash-title').textContent = config.splashTitle || 'Loyalfly';
            document.getElementById('splash-subtitle').textContent = config.splashSubtitle || 'Cargando tu cartera...';
        }
    } catch (error) {
        console.error("Error loading splash screen config:", error);
        // La app continuará con los valores por defecto
    }
};

// =================================================================
// RENDERIZADO DE VISTAS
// =================================================================
const renderDashboard = async () => {
    const cardsContainer = document.getElementById('cards-container');
    cardsContainer.innerHTML = `<p class="text-subtle-text text-center mt-4">Cargando tus tarjetas...</p>`;
    
    const balancesQuery = query(collection(db, 'loyaltyBalances'), where('clientId', '==', state.userProfile.id));
    const balancesSnapshot = await getDocs(balancesQuery);
    
    if (balancesSnapshot.empty) {
        cardsContainer.innerHTML = `<div class="text-center text-subtle-text mt-10"><p>Aún no tienes tarjetas de lealtad.</p></div>`;
        return;
    }

    const cardPromises = balancesSnapshot.docs.map(async (doc) => {
        const balance = doc.data();
        const businessDocRef = doc(db, 'businesses', balance.businessId);
        const businessDoc = await getDoc(businessDocRef);

        if (!businessDoc.exists()) return '';
        const program = businessDoc.data();
        
        const stamps = balance.stamps || 0;
        const required = program.stampsRequired || 10;
        const progress = Math.min((stamps / required) * 100, 100);
        const isRewardReady = stamps >= required;
        const circumference = 2 * Math.PI * 35; // r=35
        const strokeDashoffset = circumference - (progress / 100) * circumference;
        const cardColor = program.cardColor || '#27272A';

        const hexToRgb = (hex) => {
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
        };
        const rgb = hexToRgb(cardColor);
        const luminance = rgb ? (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255 : 0;
        const textColorClass = luminance > 0.5 ? 'text-dark-bg' : 'text-light-text';
        const subTextColorClass = luminance > 0.5 ? 'text-zinc-600' : 'text-subtle-text';

        return `
            <div class="rounded-xl shadow-lg p-5 flex flex-col justify-between h-52 ${textColorClass} ${isRewardReady ? 'ring-2 ring-oro-suave' : ''}" style="background-color: ${cardColor};">
                <header class="flex justify-between items-start">
                    <h3 class="uppercase tracking-wider text-lg font-bold">${program.name}</h3>
                    <div class="font-semibold text-menta">Loyalfly</div>
                </header>
                
                <main class="flex items-center justify-between mt-2">
                    <div>
                        <p class="text-4xl font-semibold">${stamps}<span class="text-2xl ${subTextColorClass}">/${required}</span></p>
                        <p class="text-sm ${subTextColorClass}">Sellos</p>
                        ${isRewardReady ? `<p class="mt-2 text-sm font-semibold text-oro-suave">¡Recompensa lista!</p><p class="text-xs text-oro-suave/80">${program.rewardTitle}</p>` : ''}
                    </div>
                    <div class="relative w-20 h-20 flex-shrink-0">
                        <svg class="w-full h-full" viewBox="0 0 80 80">
                            <circle class="${luminance > 0.5 ? 'text-black/20' : 'text-white/20'}" stroke-width="8" stroke="currentColor" fill="transparent" r="35" cx="40" cy="40"/>
                            <circle class="text-menta" stroke-width="8" stroke-linecap="round" stroke="currentColor" fill="transparent" r="35" cx="40" cy="40" style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${strokeDashoffset}; transition: stroke-dashoffset 0.5s ease-out; transform: rotate(-90deg); transform-origin: 50% 50%;"/>
                        </svg>
                        <span class="absolute inset-0 flex items-center justify-center text-lg font-bold">${Math.round(progress)}%</span>
                    </div>
                </main>

                <footer class="mt-auto pt-2">
                    <p class="font-mono text-lg tracking-wider uppercase">${state.userProfile.name}</p>
                </footer>
            </div>`;
    });

    cardsContainer.innerHTML = (await Promise.all(cardPromises)).join('');
};

const renderCashierView = async () => {
    const clientsListContainer = document.getElementById('clients-list-container');
    document.getElementById('business-name-header').textContent = state.userProfile.name;
    clientsListContainer.innerHTML = `<p class="text-subtle-text text-center mt-4">Cargando clientes...</p>`;

    const balancesQuery = query(collection(db, 'loyaltyBalances'), where('businessId', '==', state.authUser.uid));
    const balancesSnapshot = await getDocs(balancesQuery);

    if (balancesSnapshot.empty) {
        clientsListContainer.innerHTML = `<div class="text-center text-subtle-text mt-10 p-4"><p>Aún no tienes clientes registrados en tu programa de lealtad.</p></div>`;
        return;
    }

    const clientPromises = balancesSnapshot.docs.map(async (balanceDoc) => {
        const balance = balanceDoc.data();
        const clientDocRef = doc(db, 'clients', balance.clientId);
        const clientDoc = await getDoc(clientDocRef);
        if (!clientDoc.exists()) return '';
        const client = clientDoc.data();
        
        return `
        <div class="bg-dark-surface rounded-lg shadow-sm p-4 m-2 flex items-center justify-between">
            <div>
                <p class="font-semibold text-light-text">${client.name}</p>
                <p class="text-sm text-subtle-text">${client.phone}</p>
                <p class="text-sm font-medium text-menta mt-1">${balance.stamps} / ${state.userProfile.stampsRequired} sellos</p>
            </div>
            <button data-balance-id="${balanceDoc.id}" class="add-stamp-btn bg-menta text-dark-bg py-3 px-5 rounded-lg font-bold shadow-md hover:bg-green-300 transition">+1 Sello</button>
        </div>`;
    });

    clientsListContainer.innerHTML = (await Promise.all(clientPromises)).join('');
    document.querySelectorAll('.add-stamp-btn').forEach(btn => btn.addEventListener('click', handleAddStamp));
};

// =================================================================
// LÓGICA DE AUTENTICACIÓN Y FIREBASE
// =================================================================

const setupRecaptcha = () => {
    // Pass the actual DOM element instead of its ID string to the constructor
    // to prevent "Cannot create property 'callback' on string" error.
    const recaptchaContainer = document.getElementById('recaptcha-container');
    if (recaptchaContainer) {
        window.recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaContainer, {
            'size': 'invisible',
            'callback': (response) => { /* reCAPTCHA solved */ }
        });
    } else {
        console.error("The reCAPTCHA container element ('recaptcha-container') was not found in the DOM.");
    }
};

const handleClientLogin = async () => {
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const phoneInput = document.getElementById('phone-input') as HTMLInputElement;
    const phone = phoneInput.value.replace(/\s/g, '');
    if (phone.length !== 10) return showAlert('Por favor, ingresa un número de 10 dígitos.');
    
    const fullPhone = `+52${phone}`;
    const clientsQuery = query(collection(db, 'clients'), where('phone', '==', fullPhone));
    const clientSnapshot = await getDocs(clientsQuery);

    if (clientSnapshot.empty) {
        return showAlert('Número no encontrado. Por favor, regístrate.');
    }

    try {
        confirmationResult = await signInWithPhoneNumber(auth, fullPhone, window.recaptchaVerifier);
        showModal('otp');
        document.getElementById('otp-input').focus();
    } catch (error) {
        console.error("Error al enviar SMS:", error);
        showAlert('No se pudo enviar el código. Intenta de nuevo.');
        // Recaptcha reset is handled automatically by the SDK in modular versions
    }
};

const handleRegistration = async () => {
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const name = (document.getElementById('register-name-input') as HTMLInputElement).value.trim();
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const phone = (document.getElementById('register-phone-input') as HTMLInputElement).value.replace(/\s/g, '');

    if (!name) return showAlert('Por favor, ingresa tu nombre.');
    if (phone.length !== 10) return showAlert('Por favor, ingresa un número de 10 dígitos.');

    const fullPhone = `+52${phone}`;
    const clientsQuery = query(collection(db, 'clients'), where('phone', '==', fullPhone));
    const clientSnapshot = await getDocs(clientsQuery);
    
    if (!clientSnapshot.empty && clientSnapshot.docs[0].data().authUid) {
        return showAlert('Este número ya está registrado. Por favor, inicia sesión.');
    }

    try {
        confirmationResult = await signInWithPhoneNumber(auth, fullPhone, window.recaptchaVerifier);
        sessionStorage.setItem('pendingRegistration', JSON.stringify({ name, phone: fullPhone }));
        showModal('otp');
        document.getElementById('otp-input').focus();
    } catch (error) {
        console.error("Error al enviar SMS en registro:", error);
        showAlert('No se pudo enviar el código. Intenta de nuevo.');
    }
};

const handleOtpVerification = async () => {
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const otp = (document.getElementById('otp-input') as HTMLInputElement).value;
    if (otp.length !== 6 || !confirmationResult) return showAlert('Código inválido.');
    
    try {
        const result = await confirmationResult.confirm(otp);
        const user = result.user;
        
        const pendingRegistration = JSON.parse(sessionStorage.getItem('pendingRegistration'));
        if (pendingRegistration && user.phoneNumber === pendingRegistration.phone) {
            const clientQuery = query(collection(db, 'clients'), where('phone', '==', user.phoneNumber), limit(1));
            const clientSnapshot = await getDocs(clientQuery);

            if (clientSnapshot.empty) {
                await addDoc(collection(db, 'clients'), {
                    name: pendingRegistration.name,
                    phone: user.phoneNumber,
                    authUid: user.uid
                });
            } else {
                const clientDocRef = clientSnapshot.docs[0].ref;
                await updateDoc(clientDocRef, { authUid: user.uid, name: pendingRegistration.name });
            }
            sessionStorage.removeItem('pendingRegistration');
        }
        
        hideModal('otp');
        // FIX: Cast to HTMLInputElement to set the 'value' property.
        (document.getElementById('otp-input') as HTMLInputElement).value = '';
    } catch (error) {
        console.error("Error de verificación OTP:", error);
        showAlert('Código incorrecto. Intenta de nuevo.');
    }
};

const handleBusinessRegister = async () => {
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const name = (document.getElementById('business-name-register') as HTMLInputElement).value.trim();
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const email = (document.getElementById('business-email-register') as HTMLInputElement).value.trim();
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const password = (document.getElementById('business-password-register') as HTMLInputElement).value;
    if (!name || !email || password.length < 6) return showAlert('Por favor completa todos los campos. La contraseña debe tener al menos 6 caracteres.');
    
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        const businessDocRef = doc(db, 'businesses', user.uid);
        await setDoc(businessDocRef, {
            name: name,
            email: email,
            stampsRequired: 10,
            rewardTitle: 'Producto Gratis',
            rewardDescription: 'Reclama un producto gratis por tu lealtad.',
            cardColor: '#27272A'
        });
    } catch (error) {
        console.error("Error de registro de negocio:", error);
        showAlert(error.code === 'auth/email-already-in-use' ? 'Este correo ya está en uso.' : 'Error al registrar la cuenta.');
    }
};

const handleBusinessLogin = async () => {
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const email = (document.getElementById('business-email-login') as HTMLInputElement).value.trim();
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const password = (document.getElementById('business-password-login') as HTMLInputElement).value;
    if (!email || !password) return showAlert('Por favor, ingresa tu correo y contraseña.');
    
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error("Error de inicio de sesión de negocio:", error);
        showAlert('Correo o contraseña incorrectos.');
    }
};

const handleLogout = () => {
    signOut(auth);
};

const handleAddClient = async () => {
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const name = (document.getElementById('add-client-name') as HTMLInputElement).value.trim();
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const phone = (document.getElementById('add-client-phone') as HTMLInputElement).value.replace(/\s/g, '');

    if (!name) return showAlert('Por favor, ingresa el nombre del cliente.');
    if (phone.length !== 10) return showAlert('Por favor, ingresa un número de 10 dígitos.');
    
    const fullPhone = `+52${phone}`;
    let clientId;

    try {
        const clientQuery = query(collection(db, 'clients'), where('phone', '==', fullPhone), limit(1));
        const clientSnapshot = await getDocs(clientQuery);

        if (clientSnapshot.empty) {
            const newClientRef = await addDoc(collection(db, 'clients'), { name: name, phone: fullPhone });
            clientId = newClientRef.id;
        } else {
            clientId = clientSnapshot.docs[0].id;
        }

        const balanceQuery = query(collection(db, 'loyaltyBalances'), 
            where('businessId', '==', state.authUser.uid), 
            where('clientId', '==', clientId), 
            limit(1)
        );
        const balanceSnapshot = await getDocs(balanceQuery);

        if (!balanceSnapshot.empty) {
            return showAlert('Este cliente ya está registrado en tu programa de lealtad.', 'info');
        }

        await addDoc(collection(db, 'loyaltyBalances'), {
            businessId: state.authUser.uid,
            clientId: clientId,
            stamps: 0
        });
        
        showAlert('Cliente añadido con éxito.', 'success');
        hideModal('addClient');
        // FIX: Cast to HTMLInputElement to set the 'value' property.
        (document.getElementById('add-client-name') as HTMLInputElement).value = '';
        // FIX: Cast to HTMLInputElement to set the 'value' property.
        (document.getElementById('add-client-phone') as HTMLInputElement).value = '';
        renderCashierView();
    } catch (error) {
        console.error("Error al añadir cliente:", error);
        showAlert('No se pudo añadir el cliente. Inténtalo de nuevo.');
    }
};

const handleAddStamp = async (e) => {
    const balanceId = e.target.dataset.balanceId;
    const balanceRef = doc(db, 'loyaltyBalances', balanceId);
    
    try {
        await runTransaction(db, async (transaction) => {
            const balanceDoc = await transaction.get(balanceRef);
            if (!balanceDoc.exists()) throw "El documento no existe";
            
            const currentStamps = balanceDoc.data().stamps;
            if (currentStamps < state.userProfile.stampsRequired) {
                transaction.update(balanceRef, { stamps: currentStamps + 1 });
            } else {
                showAlert('Este cliente ya tiene una recompensa lista.', 'info');
            }
        });
        renderCashierView();
    } catch (error) {
        console.error("Error al añadir sello: ", error);
        showAlert('No se pudo añadir el sello. Inténtalo de nuevo.');
    }
};

const handleShowRewardConfig = () => {
    // FIX: Cast to HTMLInputElement to set the 'value' property.
    (document.getElementById('reward-title') as HTMLInputElement).value = state.userProfile.rewardTitle;
    // FIX: Cast to HTMLInputElement to set the 'value' property.
    (document.getElementById('reward-description') as HTMLInputElement).value = state.userProfile.rewardDescription;
    // FIX: Cast to HTMLInputElement to set the 'value' property.
    (document.getElementById('stamps-required') as HTMLInputElement).value = String(state.userProfile.stampsRequired);
    
    const currentColor = state.userProfile.cardColor || '#27272A';
    // FIX: Cast to HTMLInputElement to set the 'value' property.
    (document.getElementById('card-color-input') as HTMLInputElement).value = currentColor;
    
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const customColorPicker = document.getElementById('custom-color-picker') as HTMLInputElement;
    // FIX: Cast to HTMLElement to access the 'style' property.
    const customColorPreview = document.getElementById('custom-color-preview') as HTMLElement;
    customColorPicker.value = currentColor;
    customColorPreview.style.backgroundColor = currentColor;

    document.querySelectorAll('#color-swatches button').forEach(swatch => {
        // FIX: Cast Element to HTMLElement to access 'dataset' property.
        if ((swatch as HTMLElement).dataset.color === currentColor) {
            swatch.classList.add('ring-2', 'ring-light-text');
        } else {
            swatch.classList.remove('ring-2', 'ring-light-text');
        }
    });

    showModal('rewardConfig');
};

const handleSaveRewardConfig = async () => {
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const newTitle = (document.getElementById('reward-title') as HTMLInputElement).value;
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const newDesc = (document.getElementById('reward-description') as HTMLInputElement).value;
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const newStamps = parseInt((document.getElementById('stamps-required') as HTMLInputElement).value, 10);
    // FIX: Cast to HTMLInputElement to access the 'value' property.
    const newColor = (document.getElementById('card-color-input') as HTMLInputElement).value;
    
    if (!newTitle || !newDesc || isNaN(newStamps) || newStamps < 1) {
        return showAlert('Por favor, completa todos los campos correctamente.');
    }

    try {
        const businessDocRef = doc(db, 'businesses', state.authUser.uid);
        await updateDoc(businessDocRef, {
            rewardTitle: newTitle,
            rewardDescription: newDesc,
            stampsRequired: newStamps,
            cardColor: newColor
        });
        state.userProfile.rewardTitle = newTitle;
        state.userProfile.rewardDescription = newDesc;
        state.userProfile.stampsRequired = newStamps;
        state.userProfile.cardColor = newColor;
        hideModal('rewardConfig');
        showAlert('Recompensa actualizada con éxito.', 'success');
        renderCashierView();
    } catch (error) {
        console.error("Error al guardar configuración:", error);
        showAlert('No se pudo guardar la configuración.');
    }
};

// =================================================================
// INICIALIZACIÓN Y MANEJO DE ESTADO DE AUTH
// =================================================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Almacenar un objeto de usuario plano y serializable en el estado global.
        // Se elimina `providerData` para prevenir errores de "estructura circular a JSON".
        state.authUser = {
            uid: user.uid,
            email: user.email,
            phoneNumber: user.phoneNumber
        };
        
        if (user.providerData.some(p => p.providerId === 'password')) {
            const businessDocRef = doc(db, 'businesses', user.uid);
            const businessDoc = await getDoc(businessDocRef);
            if (businessDoc.exists()) {
                state.userType = 'business';
                state.userProfile = businessDoc.data();
                authContainer.classList.add('hidden');
                appContainer.classList.remove('hidden');
                renderCashierView();
                showView('cashier-view');
            } else {
                console.warn("Business user without profile found, logging out.");
                signOut(auth);
            }
            return;
        }

        if (user.phoneNumber) {
            const clientQuery = query(collection(db, 'clients'), where('phone', '==', user.phoneNumber), limit(1));
            const clientSnapshot = await getDocs(clientQuery);

            if (!clientSnapshot.empty) {
                const clientDoc = clientSnapshot.docs[0];
                state.userType = 'client';
                state.userProfile = { id: clientDoc.id, ...clientDoc.data() };
                
                if (!state.userProfile.authUid) {
                    await updateDoc(clientDoc.ref, { authUid: user.uid });
                }

                authContainer.classList.add('hidden');
                appContainer.classList.remove('hidden');
                renderDashboard();
                showView('dashboard-view');
            } else {
                console.warn("Client user without profile found, logging out.");
                signOut(auth);
            }
        } else {
            signOut(auth);
        }

    } else {
        state.authUser = null;
        state.userProfile = null;
        state.userType = null;
        appContainer.classList.add('hidden');
        authContainer.classList.remove('hidden');
        showView('client-login-view');
    }
    splashScreen.classList.add('hidden');
});

const init = async () => {
    // Lógica de registro del Service Worker más robusta
    if ('serviceWorker' in navigator) {
        const registerSW = () => {
            // Usar una ruta relativa al documento actual para evitar errores de origen.
            navigator.serviceWorker.register('./service-worker.js')
                .then(reg => console.log('✅ SW registered at scope:', reg.scope))
                .catch(err => console.error('❌ SW registration failed:', err));
        };

        // Esto maneja el caso donde el script se carga después de que la página se haya cargado por completo.
        if (document.readyState === 'complete') {
            registerSW();
        } else {
            window.addEventListener('load', registerSW);
        }
    }

    await loadSplashScreenConfig();
    setupRecaptcha();

    document.getElementById('login-btn').addEventListener('click', handleClientLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegistration);
    document.getElementById('otp-verify-btn').addEventListener('click', handleOtpVerification);
    document.getElementById('business-login-btn').addEventListener('click', handleBusinessLogin);
    document.getElementById('business-register-btn').addEventListener('click', handleBusinessRegister);
    
    document.getElementById('client-logout-btn').addEventListener('click', handleLogout);
    document.getElementById('cashier-logout-btn').addEventListener('click', handleLogout);
    
    document.getElementById('alert-close-btn').addEventListener('click', () => hideModal('alert'));
    document.getElementById('alert-ok-btn').addEventListener('click', () => hideModal('alert'));
    document.getElementById('reward-config-btn').addEventListener('click', handleShowRewardConfig);
    document.getElementById('save-reward-btn').addEventListener('click', handleSaveRewardConfig);
    document.getElementById('cancel-reward-btn').addEventListener('click', () => hideModal('rewardConfig'));
    
    document.getElementById('add-client-fab').addEventListener('click', () => showModal('addClient'));
    document.getElementById('cancel-add-client-btn').addEventListener('click', () => hideModal('addClient'));
    document.getElementById('save-add-client-btn').addEventListener('click', handleAddClient);

    document.querySelectorAll('#color-swatches button').forEach(swatch => {
        swatch.addEventListener('click', (e) => {
            e.preventDefault();
            // FIX: Cast Element to HTMLElement to access 'dataset' property.
            const selectedColor = (swatch as HTMLElement).dataset.color;
            // FIX: Cast to HTMLInputElement to set the 'value' property.
            (document.getElementById('card-color-input') as HTMLInputElement).value = selectedColor;
            document.querySelectorAll('#color-swatches button').forEach(s => s.classList.remove('ring-2', 'ring-light-text'));
            swatch.classList.add('ring-2', 'ring-light-text');

            // FIX: Cast to HTMLInputElement to access the 'value' property.
            const customColorPicker = document.getElementById('custom-color-picker') as HTMLInputElement;
            // FIX: Cast to HTMLElement to access the 'style' property.
            const customColorPreview = document.getElementById('custom-color-preview') as HTMLElement;
            customColorPicker.value = selectedColor;
            customColorPreview.style.backgroundColor = selectedColor;
        });
    });

    document.getElementById('custom-color-picker').addEventListener('input', (e) => {
        // FIX: Cast EventTarget to HTMLInputElement to access the 'value' property.
        const selectedColor = (e.target as HTMLInputElement).value;
        // FIX: Cast to HTMLInputElement to set the 'value' property.
        (document.getElementById('card-color-input') as HTMLInputElement).value = selectedColor;
        // FIX: Cast to HTMLElement to access the 'style' property.
        (document.getElementById('custom-color-preview') as HTMLElement).style.backgroundColor = selectedColor;
        document.querySelectorAll('#color-swatches button').forEach(s => s.classList.remove('ring-2', 'ring-light-text'));
    });

    document.getElementById('go-to-register').addEventListener('click', (e) => { e.preventDefault(); showView('registration-view'); });
    document.getElementById('go-to-login').addEventListener('click', (e) => { e.preventDefault(); showView('client-login-view'); });
    document.getElementById('go-to-business-login').addEventListener('click', (e) => { e.preventDefault(); showView('business-login-view'); });
    document.getElementById('go-to-business-register').addEventListener('click', (e) => { e.preventDefault(); showView('business-register-view'); });
    document.getElementById('go-to-client-login-from-business').addEventListener('click', (e) => { e.preventDefault(); showView('client-login-view'); });
    document.getElementById('go-to-business-login-from-register').addEventListener('click', (e) => { e.preventDefault(); showView('business-login-view'); });
};

init();