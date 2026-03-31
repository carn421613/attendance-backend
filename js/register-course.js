import { auth } from "../js/firebase.js";

const BASE_URL =
"https://attendance-backend-qj36.onrender.com";

document.addEventListener("DOMContentLoaded", () => {

  const form =
    document.getElementById("courseForm");

  const message =
    document.getElementById("formMessage");

  const submitBtn =
    form?.querySelector("button[type='submit']");

  form.addEventListener("submit", async (e) => {

    e.preventDefault();

    const name =
      document.getElementById("courseName").value.trim();

    const courseId =
      document.getElementById("courseId").value.trim().toUpperCase();

    if (!name || !courseId) {
      showMessage("Fill all fields","red");
      return;
    }

    const user = auth.currentUser;

    if (!user) {
      showMessage("Admin not logged in","red");
      return;
    }

    try {

      const token = await user.getIdToken();

      const res = await fetch(`${BASE_URL}/create-course`,{

        method:"POST",

        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${token}`
        },

        body:JSON.stringify({
          name,
          courseId
        })

      });

      const data = await res.json();

      if(!res.ok){
        showMessage(data.error,"red");
        return;
      }

      showMessage("✅ Course registered","green");

      form.reset();

    }

    catch(err){

      console.error(err);

      showMessage("Backend not reachable","red");

    }

  });

  function showMessage(text,color){

    message.textContent=text;
    message.style.color=color;

    setTimeout(()=>{
      message.textContent="";
    },4000);

  }

});