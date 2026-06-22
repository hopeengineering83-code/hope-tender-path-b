'use client';

import { AlertCircle, CheckCircle, AlertTriangle, FileText } from 'lucide-react';

interface ExtractionQualityMetrics {
  totalPages: number | null;
  extractedPages: number | null;
  ocrPages: number | null;
  failedPages: number | null;
  extractionScore: number | null;
}

interface ExtractionQualityPanelProps {
  files: ExtractionQualityMetrics[];
  analysisExtractionStatus?: string;
}

export function ExtractionQualityPanel({
  files,
  analysisExtractionStatus,
}: ExtractionQualityPanelProps) {
  const stats = files.reduce(
    (acc, file) => {
      acc.totalPages += file.totalPages || 0;
      acc.extractedPages += file.extractedPages || 0;
      acc.ocrPages += file.ocrPages || 0;
      acc.failedPages += file.failedPages || 0;
      return acc;
    },
    { totalPages: 0, extractedPages: 0, ocrPages: 0, failedPages: 0 }
  );

  const coverage = stats.totalPages > 0 ? Math.round((stats.extractedPages / stats.totalPages) * 100) : 0;
  const perfectlyExtracted = stats.extractedPages - stats.ocrPages;

  const getStatusIcon = () => {
    if (analysisExtractionStatus === 'FULL_EXTRACTION_AI_ANALYZED') {
      return <CheckCircle className="w-5 h-5 text-green-600" />;
    }
    if (analysisExtractionStatus?.includes('PARTIAL')) {
      return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
    }
    if (analysisExtractionStatus?.includes('REGEX_FALLBACK') || analysisExtractionStatus?.includes('WEAK')) {
      return <AlertCircle className="w-5 h-5 text-orange-600" />;
    }
    return <FileText className="w-5 h-5 text-gray-400" />;
  };

  const getStatusLabel = () => {
    if (analysisExtractionStatus === 'FULL_EXTRACTION_AI_ANALYZED') return 'Fully Extracted';
    if (analysisExtractionStatus?.includes('PARTIAL')) return 'Partially Extracted';
    if (analysisExtractionStatus?.includes('REGEX_FALLBACK')) return 'Regex Fallback';
    if (analysisExtractionStatus?.includes('WEAK')) return 'Weak Extraction';
    return 'Unknown';
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        {getStatusIcon()}
        <div>
          <h3 className="font-semibold text-gray-900">Extraction Quality</h3>
          <p className="text-sm text-gray-600">{getStatusLabel()}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-50 rounded p-3">
          <p className="text-xs font-medium text-gray-600">Total Pages</p>
          <p className="text-lg font-semibold text-gray-900">{stats.totalPages}</p>
        </div>
        <div className="bg-green-50 rounded p-3">
          <p className="text-xs font-medium text-gray-600">Extracted</p>
          <p className="text-lg font-semibold text-green-700">{perfectlyExtracted}</p>
        </div>
        <div className="bg-blue-50 rounded p-3">
          <p className="text-xs font-medium text-gray-600">OCR Pages</p>
          <p className="text-lg font-semibold text-blue-700">{stats.ocrPages}</p>
        </div>
        <div className="bg-red-50 rounded p-3">
          <p className="text-xs font-medium text-gray-600">Failed</p>
          <p className="text-lg font-semibold text-red-700">{stats.failedPages}</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex justify-between items-center mb-2">
          <p className="text-sm font-medium text-gray-700">Coverage</p>
          <p className="text-sm font-semibold text-gray-900">{coverage}%</p>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${coverage >= 80 ? 'bg-green-500' : coverage >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${coverage}%` }}
          />
        </div>
      </div>

      <div className="text-xs text-gray-600">
        {stats.totalPages > 0 ? (
          <p>
            {perfectlyExtracted} of {stats.totalPages} pages perfectly extracted{stats.ocrPages > 0 ? ` (${stats.ocrPages} via OCR)` : ''}
          </p>
        ) : (
          <p>No extraction data available</p>
        )}
      </div>

      {analysisExtractionStatus?.includes('WEAK') && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
          <p className="font-medium">Weak Extraction Detected</p>
          <p className="text-xs mt-1">This document has extraction quality issues. AI analysis may be less reliable.</p>
        </div>
      )}
    </div>
  );
}
