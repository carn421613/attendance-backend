import { auth } from "../js/firebase.js";
import { onAuthStateChanged } from
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const BASE_URL = "https://attendance-backend-qj36.onrender.com";

console.log("DELETE USER JS LOADED");

document.addEventListener("DOMContentLoaded", () => {
  const roleFilter = document.getElementById("roleFilter");
  const tableBody = document.querySelector("#usersTable tbody");
  const logoutBtn = document.getElementById("logoutBtn");

  let token = null;

  // 🔐 Wait for Firebase auth FIRST
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      alert("Admin not logged in");
      window.location.href = "login.html";
      return;
    }

    token = await user.getIdToken();
    console.log("TOKEN READY");
  });

  roleFilter.addEventListener("change", () => {
    if (!token) {
      alert("Please wait, authentication still loading...");
      return;
    }
    loadUsers();
  });

  logoutBtn.addEventListener("click", logout);

  async function loadUsers() {
    const role = roleFilter.value;
    tableBody.innerHTML = "";

    if (!role) return;

    try {
      const res = await fetch(`${BASE_URL}/users`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to load users");
        return;
      }

      console.log("USERS:", data);

      data
        .filter(u => u.role?.toLowerCase() === role)
        .forEach(user => {
          const tr = document.createElement("tr");

          tr.innerHTML = `
            <td>${user.name || "-"}</td>
            <td>${user.email}</td>
            <td>${user.uid}</td>
            <td>
              <button class="delete-btn">Delete</button>
            </td>
          `;

          tr.querySelector(".delete-btn")
            .addEventListener("click", () => deleteUser(user.uid));

          tableBody.appendChild(tr);
        });

    } catch (err) {
      console.error(err);
      alert("Failed to load users");
    }
  }

  async function deleteUser(uid) {
    

    try {
      const res = await fetch(`${BASE_URL}/delete-user/${uid}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Delete failed");
        return;
      }

      alert("User deleted successfully");
      loadUsers();

    } catch (err) {
      console.error(err);
      alert("Delete failed");
    }
  }

  function logout() {
    window.location.href = "login.html";
  }
});
