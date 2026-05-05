import { useState, useEffect } from 'react';
import axios from 'axios';
import { Check, X, FileText, Loader2 } from 'lucide-react';

export function AuditDashboard() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<number | null>(null);

  const fetchPending = async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/v1/audit/pending');
      if (res.data.status === 'success') {
        setDocs(res.data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleReview = async (id: number, status: 'approved' | 'rejected') => {
    try {
      setProcessingId(id);
      await axios.post(`/api/v1/audit/${id}/review`, {
        checker_id: 1, // hardcoded for MVP
        status,
        comments: ""
      });
      fetchPending();
    } catch (err) {
      console.error(err);
      alert('Action failed');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Document Audit Center</h1>
        <button onClick={fetchPending} className="px-4 py-2 bg-white border border-slate-200 rounded-md text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
        </div>
      ) : docs.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500">
          <Check className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
          <h3 className="text-lg font-medium text-slate-900">All caught up</h3>
          <p>No documents pending for audit right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {docs.map((doc) => (
            <div key={doc.id} className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm flex flex-col xl:flex-row gap-6">
              <div className="flex-1 min-w-0">
                <div className="flex items-center text-slate-900 font-semibold mb-2 truncate">
                  <FileText className="w-5 h-5 mr-2 text-slate-400 shrink-0" />
                  <span className="truncate">{doc.filename}</span>
                </div>
                <div className="bg-slate-50 rounded-md p-4 text-sm text-slate-600 font-mono overflow-auto max-h-96 border border-slate-100">
                  {doc.extracted_data ? (
                    <pre>{JSON.stringify(doc.extracted_data.generation || doc.extracted_data, null, 2)}</pre>
                  ) : (
                    <span className="italic text-slate-400">No extracted data available</span>
                  )}
                </div>
              </div>
              <div className="flex flex-row xl:flex-col gap-3 shrink-0">
                <button
                  onClick={() => handleReview(doc.id, 'approved')}
                  disabled={processingId !== null}
                  className="w-full flex justify-center items-center px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {processingId === doc.id ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  {processingId === doc.id ? 'Processing...' : 'Approve'}
                </button>
                <button
                  onClick={() => handleReview(doc.id, 'rejected')}
                  disabled={processingId !== null}
                  className="w-full flex justify-center items-center px-4 py-2 bg-white border border-rose-200 text-rose-600 rounded-md hover:bg-rose-50 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <X className="w-4 h-4 mr-2" />
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
