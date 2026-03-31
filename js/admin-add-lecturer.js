import { auth } from "../js/firebase.js";

const BASE_URL = "https://attendance-backend-qj36.onrender.com";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("addLecturerForm");
  const message = document.getElementById("formMessage");
  const logoutBtn = document.getElementById("logoutBtn");
  const submitBtn = form?.querySelector("button[type='submit']");

  if (!form) {
    console.error("Add Lecturer form not found");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (message) message.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Adding...";

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();

    if (!name || !email) {
      showMessage("Please fill all fields", "red");
      resetBtn();
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      showMessage("Admin not logged in", "red");
      resetBtn();
      return;
    }

    try {
      // 🔑 Firebase token
      const token = await user.getIdToken();

      const res = await fetch(`${BASE_URL}/create-lecturer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name, email })
      });

      const data = await res.json();

      if (!res.ok) {
        showMessage(data.error || "Failed to add lecturer", "red");
        resetBtn();
        return;
      }

      showMessage("✅ Lecturer added successfully!", "green");
      form.reset();

    } catch (err) {
      console.error(err);
      showMessage("Backend not reachable", "red");
    }

    resetBtn();
  });

  logoutBtn?.addEventListener("click", () => {
    window.location.href = "login.html";
  });

  function showMessage(text, color) {
    if (!message) return;
    message.textContent = text;
    message.style.color = color;

    setTimeout(() => {
      message.textContent = "";
    }, 4000);
  }

  function resetBtn() {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add Lecturer";
  }
});
