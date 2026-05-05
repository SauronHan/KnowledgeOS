import { useState, useEffect } from 'react';
import axios from 'axios';
import { Save, Loader2, Cpu, Eye, EyeOff, KeyRound } from 'lucide-react';

export function ConfigDashboard() {
  const [config, setConfig] = useState({
    api_keys: {
      GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      TAVILY_API_KEY: '',
      OMLX_API_BASE: 'http://host.docker.internal:8000/v1',
      OLLAMA_API_BASE: 'http://host.docker.internal:11434'
    },
    models: {
      step1_extractor: '',
      step2_graph_maker: '',
      deep_researcher: '',
      chat_model: '',
      translator_model: ''
    }
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await axios.get('/api/v1/config/models');
        if (res.data.status === 'success') {
          // Merge fetched config with default structure to prevent undefined
          setConfig({
            api_keys: { ...config.api_keys, ...(res.data.data.api_keys || {}) },
            models: { ...config.models, ...(res.data.data.models || {}) }
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);
      await axios.post('/api/v1/config/models', config);
      alert('Config saved successfully. API Keys will be applied dynamically on the next LLM call.');
    } catch (err) {
      console.error(err);
      alert('Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleApiKeyChange = (key: string, value: string) => {
    setConfig({
      ...config,
      api_keys: { ...config.api_keys, [key]: value }
    });
  };

  const handleModelChange = (key: string, value: string) => {
    setConfig({
      ...config,
      models: { ...config.models, [key]: value }
    });
  };

  const toggleKeyVisibility = (key: string) => {
    setShowKeys({ ...showKeys, [key]: !showKeys[key] });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  // Removed modelOptions array as we are switching to free-text inputs

  const renderApiKeyInput = (key: string, label: string, placeholder: string) => (
    <div className="mb-4">
      <label className="block text-sm font-semibold text-slate-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type={showKeys[key] || key === 'OLLAMA_API_BASE' ? "text" : "password"}
          value={config.api_keys[key as keyof typeof config.api_keys]}
          onChange={(e) => handleApiKeyChange(key, e.target.value)}
          placeholder={placeholder}
          className="w-full p-2.5 pr-10 bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block"
        />
        {key !== 'OLLAMA_API_BASE' && (
          <button
            type="button"
            onClick={() => toggleKeyVisibility(key)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
          >
            {showKeys[key] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );

  const renderModelInput = (key: string, label: string, description: string, placeholder: string) => {
    const value = config.models[key as keyof typeof config.models];
    return (
      <div className="mb-6">
        <label className="block text-sm font-semibold text-slate-900 mb-1">{label}</label>
        <p className="text-xs text-slate-500 mb-3">{description}</p>
        <input
          type="text"
          value={value}
          onChange={(e) => handleModelChange(key, e.target.value)}
          placeholder={placeholder}
          className="w-full md:w-3/4 p-2.5 bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block"
        />
      </div>
    );
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center mb-4 border-b border-slate-200 pb-4">
        <Cpu className="w-8 h-8 text-blue-600 mr-3" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lyrebird KOS Configuration Hub</h1>
          <p className="text-slate-500 text-sm mt-1">Manage API Keys and route different tasks to optimal LLMs dynamically.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* API Keys Section */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center">
            <KeyRound className="w-5 h-5 text-slate-500 mr-2" />
            <h2 className="text-lg font-semibold text-slate-800">Provider API Keys</h2>
          </div>
          <div className="p-6 flex-1">
            {renderApiKeyInput('GEMINI_API_KEY', 'Google Gemini API Key', 'AIzaSy...')}
            {renderApiKeyInput('DEEPSEEK_API_KEY', 'DeepSeek API Key', 'sk-...')}
            {renderApiKeyInput('ANTHROPIC_API_KEY', 'Anthropic Claude API Key', 'sk-ant-...')}
            {renderApiKeyInput('OPENAI_API_KEY', 'OpenAI API Key', 'sk-...')}
            {renderApiKeyInput('OPENROUTER_API_KEY', 'OpenRouter API Key', 'sk-or-...')}
            {renderApiKeyInput('TAVILY_API_KEY', 'Tavily Search API Key', 'tvly-...')}
            {renderApiKeyInput('OMLX_API_BASE', 'oMLX Base URL', 'http://localhost:8000/v1')}
            {renderApiKeyInput('OLLAMA_API_BASE', 'Ollama Base URL', 'http://localhost:11434')}
          </div>
        </div>

        {/* Model Routing Section */}
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4 flex items-center">
            <Cpu className="w-5 h-5 text-slate-500 mr-2" />
            <h2 className="text-lg font-semibold text-slate-800">Pipeline Routing</h2>
          </div>
          <div className="p-6 flex-1">
            {renderModelInput(
              'step1_extractor', 
              'Step 1: Entity Extractor', 
              'Handles high-volume extraction from raw text. Recommended: Fast and cheap models.',
              'e.g. gemini/gemini-2.5-flash'
            )}
            {renderModelInput(
              'step2_graph_maker', 
              'Step 2: Graph Logic Maker', 
              'Builds relationships and resolves logic. Recommended: High reasoning capabilities.',
              'e.g. anthropic/claude-3-5-sonnet-20241022'
            )}
            {renderModelInput(
              'deep_researcher', 
              'Agent: Deep Researcher', 
              'Agentic model for deep internet research and synthesis.',
              'e.g. gemini/gemini-2.5-pro'
            )}
            {renderModelInput(
              'chat_model', 
              'Frontend Chat Assistant', 
              'Default model used for answering user queries in the frontend interface.',
              'e.g. openai/gpt-4o'
            )}
            {renderModelInput(
              'translator_model', 
              'Node Translator (图谱翻译模型)', 
              'Responsible for translating graph nodes, edges and summaries into Chinese.',
              'e.g. openrouter/deepseek/deepseek-v4-pro'
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center px-8 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-lg"
        >
          {saving ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Save className="w-5 h-5 mr-2" />}
          Apply Configuration Globally
        </button>
      </div>
    </div>
  );
}
