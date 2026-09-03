export default function ItemList({ items }: { items: string[] }) {
  return (
    <ul id="item-list">
      {items.map((item) => (
        <Item key={item} name={item} />
      ))}
    </ul>
  );
}

function Item({ name }: { name: string }) {
  return <li className="item">{name}</li>;
}
