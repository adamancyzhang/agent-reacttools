interface HelloWorldProps {
  greeting: string;
}

export default function HelloWorld({ greeting }: HelloWorldProps) {
  return <p className="greet">{greeting}</p>;
}
