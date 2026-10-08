declare module "*.css";
declare module "*.txt" {
  const text: string;
  export default text;
}
declare module "*hatch-maps.js" {
  const url: string;
  export default url;
}
