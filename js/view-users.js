import { auth } from "../js/firebase.js";
import { onAuthStateChanged, signOut }
from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import { protectPage } from "./auth-guard.js";

protectPage("admin");

const tableBody =
  document.querySelector("#usersTable tbody");


onAuthStateChanged(auth, async (user) => {

  if (!user) {

    alert("Admin not logged in");
    return;

  }

  try {

    const token = await user.getIdToken();

    const res = await fetch(
      "https://attendance-backend-qj36.onrender.com/users",
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      }
    );

    const data = await res.json();

    if (!res.ok) {

      alert(data.error || "Failed to load users");
      return;

    }

    console.log("USERS FROM API:", data);

    tableBody.innerHTML = "";

    data.forEach(u => {

      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${u.name || "-"}</td>
        <td>${u.email}</td>
        <td>${u.role}</td>
        <td style="font-size:12px">${u.uid}</td>
      `;

      tableBody.appendChild(tr);

    });

  }

  catch (err) {

    console.error("Failed to load users:", err);

  }

});


window.logout = function () {

  signOut(auth).then(() => {

    window.location.href = "login.html";

  });

};