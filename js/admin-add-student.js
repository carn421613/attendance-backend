import { auth } from "../js/firebase.js";

const BASE_URL = "https://attendance-backend-qj36.onrender.com";

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("addStudentForm");
  const message = document.getElementById("formMessage");
  const submitBtn = form.querySelector("button[type='submit']");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    message.textContent = "";
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
      const token = await user.getIdToken();

      const res = await fetch(`${BASE_URL}/create-student`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ name, email })
      });

      const data = await res.json();

      if (!res.ok) {
        showMessage(data.error || "Failed to add student", "red");
        resetBtn();
        return;
      }

      showMessage("✅ Student added successfully!", "green");
      form.reset();

    } catch (err) {
      console.error(err);
      showMessage("Backend not reachable", "red");
    }

    resetBtn();
  });

  function showMessage(text, color) {
    message.textContent = text;
    message.style.color = color;

    setTimeout(() => {
      message.textContent = "";
    }, 4000);
  }

  function resetBtn() {
    submitBtn.disabled = false;
    submitBtn.textContent = "Add Student";
  }
});
