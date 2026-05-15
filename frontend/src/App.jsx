import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AgentsProvider } from './context/AgentsContext.jsx'
import { ChatHistoryProvider } from './context/ChatHistoryContext.jsx'
import Navbar from './components/Navbar.jsx'
import Chat from './pages/Chat.jsx'
import Attacks from './pages/Attacks.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <AgentsProvider>
        <ChatHistoryProvider>
          <Navbar />
          <main style={{ paddingTop: 'var(--navbar-height)' }}>
            <Routes>
              <Route path="/" element={<Chat />} />
              <Route path="/attacks" element={<Attacks />} />
            </Routes>
          </main>
        </ChatHistoryProvider>
      </AgentsProvider>
    </BrowserRouter>
  )
}