import {categories,sampleWarnings,severityIcons,type Severity} from '../lib/site';
export function SeverityTag({value}:{value:Severity}){return <span className={`severity severity-${value.toLowerCase()}`}><span aria-hidden="true">{severityIcons[value]}</span>{value}</span>}
export function Warnings(){return <ul className="warnings">{categories.map((name,i)=><li key={name}><span>{name}</span><SeverityTag value={sampleWarnings[i]}/></li>)}</ul>}
