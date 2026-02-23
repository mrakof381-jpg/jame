import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { useStore } from "./store";
import { encryptionManager } from "./utils/encryptionManager";

function AuthChecker() {
  const { checkAuth } = useStore();
  
  useEffect(() => {
    encryptionManager.waitReady();
    checkAuth();
  }, []);
  
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthChecker />
    <App />
  </StrictMode>
);
