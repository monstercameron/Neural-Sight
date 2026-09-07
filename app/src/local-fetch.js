// Retry only idempotent reads, with bounded attempts and useful endpoint errors.
export async function fetchLocal(url, {fetcher=fetch, attempts=3, timeout=20000}={}) {
  let cause;
  for(let attempt=0;attempt<attempts;attempt++) {
    try {
      const response=await fetcher(url,{signal:AbortSignal.timeout(timeout)});
      if(response.ok)return response;
      const error=new Error(`HTTP ${response.status}`);
      if(response.status>=400 && response.status<500) {
        error.permanent=true;throw error;
      }
      throw error;
    } catch(error) {
      cause=error;
      if(error.permanent)break;
    }
  }
  throw new Error(`Could not load ${url}: ${cause?.message || 'network unavailable'}. Retry the level; check your connection and publisher availability.`,{cause});
}
