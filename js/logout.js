import { auth } from "./firebase.js";
import { signOut } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

window.logout = async function () {
  try {
    // 🔐 Firebase sign out
    await signOut(auth);

    // 🧹 Clear stored auth data
    localStorage.clear();
    sessionStorage.clear();

    // 🚪 Redirect to common login page
    window.location.href = "../login/login.html";
  } catch (err) {
    console.error("Logout failed:", err);
    alert("Logout failed");
  }
};
