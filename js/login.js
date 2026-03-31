import { auth, db } from "../js/firebase.js";

import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

import {
  doc, getDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

document.getElementById("loginBtn").addEventListener("click", async function () {
  console.log("LOGIN FUNCTION CALLED");

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    console.log("AUTH SUCCESS");

    // 🔥 GET FIREBASE ID TOKEN
    const token = await userCred.user.getIdToken();

    // 🔥 STORE TOKEN (THIS WAS MISSING)
    localStorage.setItem("token", token);

    console.log("🔥 ADMIN TOKEN 🔥", token);

    const uid = userCred.user.uid;

    if (!navigator.onLine) {
      throw new Error("No internet connection. Please check your network and try again.");
    }

    const userDoc = await getDoc(doc(db, "users", uid));

    if (!userDoc.exists()) {
      alert("User role not found in Firestore");
      return;
    }

    const role = userDoc.data().role.toLowerCase();

    if (role === "admin") {
      window.location.href = "dashboard.html";
    }
    else if (role === "student") {
      window.location.href = "../student/student_dashboard.html";
    }
    else if (role === "lecturer") {
      window.location.href = "../lecturer/lecturer_dashboard.html";
    }
    else {
      alert("Unknown role: " + role);
    }

  } catch (error) {
    console.error("LOGIN ERROR:", error);
    if (!navigator.onLine || error.message.toLowerCase().includes("offline")) {
      alert("Login failed: Network connection issue. Please connect to the internet and try again.");
    } else {
      alert("Login failed: " + error.message);
    }
  }
});

import { sendPasswordResetEmail } from
"https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

window.resetPassword = async function () {
  const email = document.getElementById("email").value;

  if (!email) {
    alert("Please enter your email first");
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    alert("Password reset email sent. Check your inbox or spam.");
  } catch (err) {
    alert(err.message);
  }
};


