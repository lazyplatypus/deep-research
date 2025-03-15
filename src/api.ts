import cors from 'cors';
import express, { Request, Response } from 'express';

import { deepResearch, writeFinalReport } from './deep-research';

const app = express();
const port = process.env.PORT || 3051;

// Middleware
app.use(cors());
app.use(express.json());

// Helper function for consistent logging
function log(...args: any[]) {
  console.log(...args);
}

// Helper function to send SSE data
function sendSSE(res: Response, event: string, data: any) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// API endpoint to run research with streaming
app.post('/api/research/stream', async (req: Request, res: Response) => {
  try {
    const { query, depth = 3, breadth = 3 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    log('\nStarting research...\n');
    sendSSE(res, 'start', { query, depth, breadth });

    const allLearnings: string[] = [];
    const allUrls: string[] = [];

    // Stream research progress
    const { learnings: finalLearnings, visitedUrls: finalUrls } = await deepResearch({
      query,
      breadth,
      depth,
      onProgress: (progress) => {
        sendSSE(res, 'progress', progress);
      },
      onQuery: (query, goal) => {
        sendSSE(res, 'query', { query, goal });
      },
      onLearning: (learning) => {
        allLearnings.push(learning);
        sendSSE(res, 'learning', { learning, totalLearnings: allLearnings.length });
      },
      onUrl: (url) => {
        allUrls.push(url);
        sendSSE(res, 'url', { url, totalUrls: allUrls.length });
      },
    });

    // Add any remaining results that weren't caught by the callbacks
    const remainingLearnings = finalLearnings.filter(l => !allLearnings.includes(l));
    const remainingUrls = finalUrls.filter(u => !allUrls.includes(u));

    if (remainingLearnings.length > 0) {
      remainingLearnings.forEach(learning => {
        allLearnings.push(learning);
        sendSSE(res, 'learning', { learning, totalLearnings: allLearnings.length });
      });
    }

    if (remainingUrls.length > 0) {
      remainingUrls.forEach(url => {
        allUrls.push(url);
        sendSSE(res, 'url', { url, totalUrls: allUrls.length });
      });
    }

    log(`\n\nLearnings:\n\n${allLearnings.join('\n')}`);
    log(`\n\nVisited URLs (${allUrls.length}):\n\n${allUrls.join('\n')}`);

    // Send summary events
    sendSSE(res, 'learnings_summary', { learnings: allLearnings });
    sendSSE(res, 'urls_summary', { urls: allUrls });

    // Generate and stream the final report
    sendSSE(res, 'report_start', { message: 'Generating final report...' });
    const report = await writeFinalReport({
      prompt: query,
      learnings: allLearnings,
      visitedUrls: allUrls,
    });

    // Send the final report
    sendSSE(res, 'report', { report });

    // End the stream
    sendSSE(res, 'done', { success: true });
    res.end();
  } catch (error: unknown) {
    console.error('Error in research API:', error);
    sendSSE(res, 'error', {
      error: 'An error occurred during research',
      message: error instanceof Error ? error.message : String(error),
    });
    res.end();
  }
});

// Keep the original endpoint for backward compatibility
app.post('/api/research', async (req: Request, res: Response) => {
  try {
    const { query, depth = 3, breadth = 3 } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    log('\nStarting research...\n');

    const { learnings, visitedUrls } = await deepResearch({
      query,
      breadth,
      depth,
    });

    log(`\n\nLearnings:\n\n${learnings.join('\n')}`);
    log(`\n\nVisited URLs (${visitedUrls.length}):\n\n${visitedUrls.join('\n')}`);

    const report = await writeFinalReport({
      prompt: query,
      learnings,
      visitedUrls,
    });

    // Return the results
    return res.json({
      success: true,
      report,
      learnings,
      visitedUrls,
    });
  } catch (error: unknown) {
    console.error('Error in research API:', error);
    return res.status(500).json({
      error: 'An error occurred during research',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Deep Research API running on port ${port}`);
});

export default app;
