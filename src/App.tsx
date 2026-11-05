import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CallProvider } from './components/CallFlow';
import { Layout } from './components/Layout';
import { SuggestionBox } from './components/SuggestionBox';
import { Toaster } from './components/ui';
import CallMode from './pages/CallMode';
import { ContactDetail, ContactsList } from './pages/Contacts';
import Dashboard from './pages/Dashboard';
import LeadDetail from './pages/LeadDetail';
import LeadFinder from './pages/LeadFinder';
import Leads from './pages/Leads';
import Pipeline from './pages/Pipeline';
import Settings from './pages/Settings';
import Suggestions from './pages/Suggestions';
import TasksPage from './pages/TasksPage';

const PAGE_NAMES: [RegExp, string][] = [
  [/^\/$/, 'Dashboard'], [/^\/call/, 'Call Mode'], [/^\/leads\/.+/, 'Lead Detail'], [/^\/leads/, 'Leads'], [/^\/finder/, 'Lead Finder'],
  [/^\/contacts\/.+/, 'Contact Detail'], [/^\/contacts/, 'Contacts'], [/^\/pipeline/, 'Pipeline'], [/^\/tasks/, 'Follow-ups'],
  [/^\/suggestions/, 'Suggestions'], [/^\/settings/, 'Settings'],
];

function PageSuggestions() {
  const loc = useLocation();
  const name = PAGE_NAMES.find(([r]) => r.test(loc.pathname))?.[1] || 'General';
  return <SuggestionBox key={name} page={name} />;
}

export default function App() {
  return (
    <HashRouter>
      <CallProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/call" element={<CallMode />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/leads/:id" element={<LeadDetail />} />
            <Route path="/finder" element={<LeadFinder />} />
            <Route path="/contacts" element={<ContactsList />} />
            <Route path="/contacts/:id" element={<ContactDetail />} />
            <Route path="/pipeline" element={<Pipeline />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/suggestions" element={<Suggestions />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
          <PageSuggestions />
        </Layout>
        <Toaster />
      </CallProvider>
    </HashRouter>
  );
}
