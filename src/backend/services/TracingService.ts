import * as AWSXRay from 'aws-xray-sdk-core';
import * as AWS from 'aws-sdk';
import { performance } from 'perf_hooks';

// Capture AWS SDK calls with X-Ray
const tracedAWS = AWSXRay.captureAWS(AWS);

export interface TraceMetadata {
  userId?: string;
  requestId?: string;
  operation?: string;
  contentType?: string;
  visibility?: string;
  [key: string]: any;
}

export interface PerformanceMetrics {
  duration: number;
  startTime: number;
  endTime: number;
  memoryUsed?: number;
  cpuUsage?: number;
}

export interface TraceSegment {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  metadata?: TraceMetadata;
  error?: Error;
  subsegments?: TraceSegment[];
}

/**
 * Service for distributed tracing and performance monitoring
 * Integrates with AWS X-Ray for comprehensive application insights
 */
export class TracingService {
  private static instance: TracingService;
  private activeSegments: Map<string, any> = new Map();
  private performanceMarks: Map<string, number> = new Map();

  private constructor() {
    // Configure X-Ray
    if (process.env.AWS_XRAY_TRACING_NAME) {
      AWSXRay.config([
        AWSXRay.plugins.ECSPlugin,
        AWSXRay.plugins.EC2Plugin,
      ]);
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): TracingService {
    if (!TracingService.instance) {
      TracingService.instance = new TracingService();
    }
    return TracingService.instance;
  }

  /**
   * Start a new trace segment
   */
  public startSegment(name: string, metadata?: TraceMetadata): string {
    const segmentId = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    if (process.env._X_AMZN_TRACE_ID) {
      const segment = AWSXRay.getSegment();
      if (segment) {
        const subsegment = segment.addNewSubsegment(name);

        if (metadata) {
          Object.entries(metadata).forEach(([key, value]) => {
            subsegment.addAnnotation(key, value);
          });
        }

        this.activeSegments.set(segmentId, subsegment);
      }
    }

    // Also track with performance API for local monitoring
    this.performanceMarks.set(segmentId, performance.now());

    return segmentId;
  }

  /**
   * End a trace segment
   */
  public endSegment(segmentId: string, error?: Error): PerformanceMetrics | null {
    const startTime = this.performanceMarks.get(segmentId);
    if (!startTime) {
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Close X-Ray subsegment if exists
    const subsegment = this.activeSegments.get(segmentId);
    if (subsegment) {
      if (error) {
        subsegment.addError(error);
      }
      subsegment.close();
      this.activeSegments.delete(segmentId);
    }

    this.performanceMarks.delete(segmentId);

    return {
      duration,
      startTime,
      endTime,
      memoryUsed: process.memoryUsage().heapUsed,
    };
  }

  /**
   * Trace an async operation
   */
  public async traceAsync<T>(
    name: string,
    operation: () => Promise<T>,
    metadata?: TraceMetadata
  ): Promise<T> {
    const segmentId = this.startSegment(name, metadata);

    try {
      const result = await operation();
      this.endSegment(segmentId);
      return result;
    } catch (error) {
      this.endSegment(segmentId, error as Error);
      throw error;
    }
  }

  /**
   * Trace a synchronous operation
   */
  public trace<T>(
    name: string,
    operation: () => T,
    metadata?: TraceMetadata
  ): T {
    const segmentId = this.startSegment(name, metadata);

    try {
      const result = operation();
      this.endSegment(segmentId);
      return result;
    } catch (error) {
      this.endSegment(segmentId, error as Error);
      throw error;
    }
  }

  /**
   * Add custom annotation to current segment
   */
  public addAnnotation(key: string, value: string | number | boolean): void {
    const segment = AWSXRay.getSegment();
    if (segment) {
      segment.addAnnotation(key, value);
    }
  }

  /**
   * Add custom metadata to current segment
   */
  public addMetadata(namespace: string, key: string, value: any): void {
    const segment = AWSXRay.getSegment();
    if (segment) {
      segment.addMetadata(namespace, key, value);
    }
  }

  /**
   * Trace database query
   */
  public async traceQuery<T>(
    queryName: string,
    query: () => Promise<T>,
    sql?: string
  ): Promise<T> {
    const metadata: TraceMetadata = {
      operation: 'database',
      queryName,
    };

    if (sql) {
      // Sanitize SQL for logging (remove sensitive data)
      const sanitizedSql = sql.replace(/\$\d+/g, '?');
      metadata.query = sanitizedSql.substring(0, 500); // Limit query length
    }

    return this.traceAsync(`DB:${queryName}`, query, metadata);
  }

  /**
   * Trace HTTP request
   */
  public async traceHttpRequest<T>(
    method: string,
    url: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const metadata: TraceMetadata = {
      operation: 'http',
      method,
      url,
    };

    return this.traceAsync(`HTTP:${method}:${url}`, operation, metadata);
  }

  /**
   * Trace Lambda function execution
   */
  public async traceLambda<T>(
    functionName: string,
    handler: () => Promise<T>,
    event?: any
  ): Promise<T> {
    const metadata: TraceMetadata = {
      operation: 'lambda',
      functionName,
      requestId: event?.requestContext?.requestId,
      userId: event?.requestContext?.authorizer?.userId,
    };

    return this.traceAsync(`Lambda:${functionName}`, handler, metadata);
  }

  /**
   * Trace cache operation
   */
  public async traceCache<T>(
    operation: 'get' | 'set' | 'delete',
    key: string,
    handler: () => Promise<T>
  ): Promise<T> {
    const metadata: TraceMetadata = {
      operation: 'cache',
      cacheOperation: operation,
      cacheKey: key,
    };

    return this.traceAsync(`Cache:${operation}:${key}`, handler, metadata);
  }

  /**
   * Create custom metric
   */
  public recordMetric(
    name: string,
    value: number,
    unit: 'Milliseconds' | 'Count' | 'Bytes' | 'Percent' = 'Count'
  ): void {
    // In production, this would send to CloudWatch
    console.log(`Metric: ${name} = ${value} ${unit}`);

    // Add to X-Ray metadata
    this.addMetadata('metrics', name, { value, unit, timestamp: Date.now() });
  }

  /**
   * Record error with context
   */
  public recordError(error: Error, context?: TraceMetadata): void {
    const segment = AWSXRay.getSegment();
    if (segment) {
      segment.addError(error);

      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          segment.addAnnotation(`error_${key}`, String(value));
        });
      }
    }

    // Log for debugging
    console.error('Traced Error:', {
      error: error.message,
      stack: error.stack,
      context,
    });
  }

  /**
   * Get performance summary for current execution
   */
  public getPerformanceSummary(): {
    activeSegments: number;
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
  } {
    return {
      activeSegments: this.activeSegments.size,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };
  }

  /**
   * Trace repository operation with automatic naming
   */
  public async traceRepository<T>(
    repository: string,
    method: string,
    operation: () => Promise<T>,
    metadata?: TraceMetadata
  ): Promise<T> {
    const enhancedMetadata: TraceMetadata = {
      ...metadata,
      operation: 'repository',
      repository,
      method,
    };

    return this.traceAsync(`Repo:${repository}:${method}`, operation, enhancedMetadata);
  }

  /**
   * Create a distributed trace context for cross-service calls
   */
  public createTraceContext(): { [key: string]: string } {
    const segment = AWSXRay.getSegment();
    if (!segment) {
      return {};
    }

    return {
      'X-Amzn-Trace-Id': segment.trace_id,
      'X-Amzn-Segment-Id': segment.id,
      'X-Amzn-Sampled': segment.notTraced ? '0' : '1',
    };
  }

  /**
   * Inject trace context into HTTP headers
   */
  public injectTraceHeaders(headers: { [key: string]: string }): { [key: string]: string } {
    return {
      ...headers,
      ...this.createTraceContext(),
    };
  }

  /**
   * Measure operation latency
   */
  public measureLatency(operationName: string): () => void {
    const startTime = performance.now();

    return () => {
      const duration = performance.now() - startTime;
      this.recordMetric(`${operationName}_latency`, duration, 'Milliseconds');
    };
  }

  /**
   * Batch trace multiple operations
   */
  public async traceBatch<T>(
    operations: Array<{
      name: string;
      handler: () => Promise<T>;
      metadata?: TraceMetadata;
    }>
  ): Promise<T[]> {
    const results: T[] = [];

    for (const op of operations) {
      const result = await this.traceAsync(op.name, op.handler, op.metadata);
      results.push(result);
    }

    return results;
  }

  /**
   * Create performance report
   */
  public generatePerformanceReport(): {
    timestamp: number;
    memory: NodeJS.MemoryUsage;
    cpu: NodeJS.CpuUsage;
    activeTraces: number;
    uptime: number;
  } {
    return {
      timestamp: Date.now(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      activeTraces: this.activeSegments.size,
      uptime: process.uptime(),
    };
  }
}

// Export singleton instance
export const tracing = TracingService.getInstance();

// Export traced AWS SDK
export { tracedAWS };

// Middleware for Express/Lambda
export function tracingMiddleware(serviceName: string) {
  return (req: any, res: any, next: any) => {
    const metadata: TraceMetadata = {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    };

    const segmentId = tracing.startSegment(`${serviceName}:${req.method}:${req.path}`, metadata);

    // Attach to response finish event
    res.on('finish', () => {
      const metrics = tracing.endSegment(segmentId);
      if (metrics) {
        tracing.recordMetric(`${serviceName}_request_duration`, metrics.duration, 'Milliseconds');
        tracing.recordMetric(`${serviceName}_status_${res.statusCode}`, 1, 'Count');
      }
    });

    next();
  };
}

// Lambda wrapper for automatic tracing
export function traceLambdaHandler<TEvent = any, TResult = any>(
  handlerName: string,
  handler: (event: TEvent, context: any) => Promise<TResult>
): (event: TEvent, context: any) => Promise<TResult> {
  return async (event: TEvent, context: any): Promise<TResult> => {
    return tracing.traceLambda(handlerName, () => handler(event, context), event);
  };
}