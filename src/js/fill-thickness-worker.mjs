import {estimateFillThickness} from './fill-thickness.js';
self.onmessage=({data:{depth,reconstruction}})=>{
  try{
    const result=estimateFillThickness(depth,reconstruction);
    self.postMessage({ok:true,result},Object.values(result).map(v=>v.buffer));
  }catch(error){self.postMessage({ok:false,error:error.message});}
};
