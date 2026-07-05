'use client';

import { CheckCircleIcon, AlertCircleIcon, WarningIcon, LockIcon, LightbulbIcon } from './icons';
import type { GenerationGateStatus } from '@/lib/generation-gates';

interface GenerationGatesPanelProps {
  gates: GenerationGateStatus;
  onGenerateDocs?: () => void;
  isGenerating?: boolean;
}

export function GenerationGatesPanel({
  gates,
  onGenerateDocs,
  isGenerating,
}: GenerationGatesPanelProps) {
  const gateItems = [
    {
      label: 'Page Extraction',
      passed: gates.extractionOk,
      description: 'Document pages successfully extracted and analyzed',
    },
    {
      label: 'Client Details',
      passed: gates.clientDetailsOk,
      description: 'Procuring entity identified from tender',
    },
    {
      label: 'Requirements',
      passed: gates.requirementsOk,
      description: 'Tender requirements extracted and classified',
    },
    {
      label: 'Submission Plan',
      passed: gates.submissionPlanOk,
      description: 'Submission method and contact details available',
    },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-gray-900">Document Generation Readiness</h3>
        {gates.allGatesMet ? (
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircleIcon />
            <span className="text-sm font-medium">Ready</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-red-700">
            <LockIcon />
            <span className="text-sm font-medium">Blocked</span>
          </div>
        )}
      </div>

      {/* Gates Status */}
      <div className="space-y-3 mb-6">
        {gateItems.map((item) => (
          <div
            key={item.label}
            className={`flex items-start gap-3 p-3 rounded border ${
              item.passed
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            {item.passed ? (
              <CheckCircleIcon className="text-green-600 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircleIcon className="text-red-600 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${item.passed ? 'text-green-900' : 'text-red-900'}`}>
                {item.label}
              </p>
              <p className={`text-xs mt-1 ${item.passed ? 'text-green-700' : 'text-red-700'}`}>
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Blockers */}
      {gates.blockers.length > 0 && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded">
          <div className="flex items-start gap-2 mb-2">
            <WarningIcon className="text-red-600 mt-0.5 flex-shrink-0" />
            <h4 className="font-medium text-red-900">Blocked - Cannot Generate</h4>
          </div>
          <ul className="text-sm text-red-800 space-y-1">
            {gates.blockers.map((blocker, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-red-600 mt-0.5">•</span>
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {gates.recommendations.length > 0 && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded">
          <div className="flex items-start gap-2 mb-2">
            <LightbulbIcon className="text-blue-600 mt-0.5 flex-shrink-0" />
            <h4 className="font-medium text-blue-900">Recommendations</h4>
          </div>
          <ul className="text-sm text-blue-800 space-y-1">
            {gates.recommendations.map((rec, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-blue-600 mt-0.5">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Generate Button */}
      <button
        onClick={onGenerateDocs}
        disabled={!gates.allGatesMet || isGenerating}
        className={`w-full py-2 px-4 rounded font-medium transition-colors ${
          gates.allGatesMet && !isGenerating
            ? 'bg-blue-600 hover:bg-blue-700 text-white'
            : 'bg-gray-200 text-gray-500 cursor-not-allowed'
        }`}
      >
        {isGenerating ? 'Generating Documents...' : 'Generate Documents'}
      </button>
    </div>
  );
}
