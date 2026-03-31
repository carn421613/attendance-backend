import { initializeApp } from
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";

import { getFirestore } from
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import { getStorage } from
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

import { getAuth } from
  "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

  const firebaseConfig = {
    apiKey: "AIzaSyDMVhanYH8j5hg2IFWXK-1GfGU7QzTdrcs",
    authDomain: "cloud-attendance-system-16a3a.firebaseapp.com",
    projectId: "cloud-attendance-system-16a3a",
    storageBucket: "cloud-attendance-system-16a3a.firebasestorage.app",
    messagingSenderId: "382622301598",
    appId: "1:382622301598:web:6c83f8c2b8e8bdcaa82a8f",
    measurementId: "G-BH4RVF9YPM"
  };

const app = initializeApp(firebaseConfig);

// EXPORT BACKEND SERVICES
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
