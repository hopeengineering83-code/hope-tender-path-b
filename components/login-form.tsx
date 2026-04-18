const res = await fetch("/api/auth/login", {
  method: "POST",
  body: JSON.stringify({ email, password }),
});

if (res.ok) {
  window.location.href = "/dashboard";
}
