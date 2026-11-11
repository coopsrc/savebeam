import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import "./App.css";

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/download" replace />} />
        <Route path="/download" element={null} />
        <Route path="/tasks" element={null} />
        <Route path="/history" element={null} />
        <Route path="/subscriptions" element={null} />
        <Route path="/settings" element={null} />
        <Route path="*" element={<Navigate to="/download" replace />} />
      </Route>
    </Routes>
  );
}
export default App;
