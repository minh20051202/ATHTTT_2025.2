import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AgentsProvider } from './context/AgentsContext.jsx'
import { ChatHistoryProvider } from './context/ChatHistoryContext.jsx'
import Navbar from './components/Navbar.jsx'
import Landing from './pages/Landing.jsx'
import Chat from './pages/Chat.jsx'
import Attacks from './pages/Attacks.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <AgentsProvider>
        <ChatHistoryProvider>
          <Navbar />
          <main style={{ paddingTop: '64px' }}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/attacks" element={<Attacks />} />
            </Routes>
          </main>
        </ChatHistoryProvider>
      </AgentsProvider>
    </BrowserRouter>
  )
}