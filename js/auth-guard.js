import { auth, db } from "../js/firebase.js";

import { onAuthStateChanged }
from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import { doc, getDoc }
from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

export function protectPage(allowedRole) {

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "../login/login.html";
      return;
    }
    window.currentUserUID = user.uid;
    console.log("Logged in UID:", user.uid);

    if (!navigator.onLine) {
      alert("Offline: Please check your internet connection and reload.");
      await auth.signOut();
      window.location.href = "../login/login.html";
      return;
    }

    let userDoc;
    try {
      userDoc = await getDoc(doc(db, "users", user.uid));
    } catch (error) {
      console.error("Auth guard Firestore error:", error);
      alert("Unable to verify role right now. Please reconnect and try again.");
      await auth.signOut();
      window.location.href = "../login/login.html";
      return;
    }

    if (!userDoc.exists()) {
      alert("User role not found");
      await auth.signOut();
      window.location.href = "../index.html";
      return;
    }

    const role = userDoc.data().role.toLowerCase();

    if (role !== allowedRole.toLowerCase()) {
      alert(`Access denied: Only ${allowedRole} allowed`);
      await auth.signOut();
      window.location.href = "../index.html";
    }

  });

}
