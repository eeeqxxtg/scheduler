const Date = window.Date;
const performance = window.performance;
const requestAnimationFrame = window.requestAnimationFrame;
const cancelAnimationFrame = window.cancelAnimationFrame;
const setTimeout = window.setTimeout;
const clearTimeout = window.clearTimeout;

let getCurrentTime: () => number;
if (
  typeof performance === 'object' &&
  typeof performance.now === 'function'
) {
  getCurrentTime = () => performance.now();
} else {
  const initialTime = Date.now();
  getCurrentTime = () => Date.now() - initialTime;
}

let rAFId;
let timeoutId;
// 超时保护，比如tab页隐藏的时候,也要把任务执行完成
const rAFwidthTimeout = (callback, timeout = 100) => {
  rAFId = requestAnimationFrame((timestamp) => {
    clearTimeout(timeoutId);
    callback(timestamp);
  });
  timeoutId = setTimeout(() => {
    cancelAnimationFrame(rAFId);
    callback(getCurrentTime());
  }, timeout);
};

type ITimeoutCallback = (() => void);
let setZeroTimeout: (fn: ITimeoutCallback) => number;
let clearZeroTimeout: (timeId: number) => void;
if (typeof MessageChannel === 'function') {
  let timeId = 0;
  const fnMap: Record<number, ITimeoutCallback | null> = {};

  const handleMessage = (tId: number) => {
    const callback = fnMap[tId];
    if (callback) {
      callback();
    }
  };

  setZeroTimeout = (fn) => {
    timeId++;
    const channel = new MessageChannel();
    const port = channel.port2;
    channel.port1.onmessage = () => handleMessage(timeId);
    fnMap[timeId] = fn;
    port.postMessage(null);
    return timeId;
  };

  clearZeroTimeout = (tId: number) => {
    if (fnMap[tId]) {
      fnMap[tId] = null;
    }
  };
} else {
  setZeroTimeout = (fn) => setTimeout(fn, 0) as any as number;
  clearZeroTimeout = (tId) => clearTimeout(tId);
}

// rAF 在每次paint之前调用
// 通过setZeroTimeout异步，在paint完成后执行
export const afterFrame = (fn: ITimeoutCallback) => {
  rAFwidthTimeout(() => {
    setZeroTimeout(fn);
  });
};

let frameTime = 8;
let deadline = 0;
let scheduledCallback: ITimeoutCallback | null = null;
let scheduledId = 0;
export const requestHostCallback = (fn: ITimeoutCallback) => {
  scheduledCallback = fn;
  if (scheduledId) {
    clearZeroTimeout(scheduledId);
  }
  scheduledId = setZeroTimeout(() => {
    deadline = getCurrentTime() + frameTime;
    try {
      if (scheduledCallback) {
        scheduledCallback();
      }
    } catch (error) {
      throw error;
    } finally {
      scheduledCallback = null;
    }
  });
};

export const cancelHostCallback = () => {
  scheduledCallback = null;
};

export const shouldYieldToHost = () => {
  if (getCurrentTime() >= deadline) {
    return true;
  } else {
    return false;
  }
};

export const forceFrameRate = (fps: number = 125) => {
  if (fps <= 0 || fps > 125) {
    throw new Error('帧率应该大于0小于等于125');
  }
  if (fps < 125) {
    frameTime = Math.floor(1000 / fps);
  }
};

interface IAsyncTask {
  key: string;
  (): void;
}

// tslint:disable-next-line:no-empty
const noop = () => {};

const asyncTasks: IAsyncTask[] = [];
const addTask = (task: IAsyncTask) => {
  const index = asyncTasks.findIndex(v => v.key === task.key);
  if (index > -1) {
    asyncTasks.splice(index, 1);
  }
  asyncTasks.push(task);
};

let asyncWorking = false;
export const workAsync = (task: IAsyncTask, onComplete = noop, onTick = (taskId: string) => noop()) => {

  addTask(task);

  if (asyncWorking) {
    return;
  }

  const tick = () => {
    while (asyncTasks.length && !shouldYieldToHost()) {
      const currTask = asyncTasks.shift();
      if (currTask) {
        onTick(currTask.key);
        currTask();
      }
    }
    if (asyncTasks.length) {
      requestHostCallback(tick);
    } else {
      asyncWorking = false;
      onComplete();
    }
  };

  rAFwidthTimeout(() => {
    requestHostCallback(tick);
    asyncWorking = true;
  });

};
